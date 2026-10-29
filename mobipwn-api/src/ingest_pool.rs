//! Bounded ingest worker pool — Postgres-backed queue with admin-tunable concurrency.
//!
//! Workers claim jobs via `FOR UPDATE SKIP LOCKED`, so API and dedicated ingest-worker
//! processes can share the same queue across hosts (when upload/blob storage is shared).

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::Notify;
use uuid::Uuid;

use crate::ingest::process_ingest_job;
use crate::AppState;

/// Upper bound on spawned waiter tasks (actual concurrency is capped by [`IngestWorkerPool::configured`]).
pub const MAX_INGEST_WORKERS: usize = 16;

#[derive(Clone)]
pub struct IngestWorkerPool {
    /// Desired concurrent parse/insert slots (admin setting / env).
    configured: Arc<AtomicUsize>,
    /// Max pending jobs (`0` = unlimited).
    max_queue: Arc<AtomicU32>,
    /// Rows per ClickHouse insert chunk.
    insert_chunk_size: Arc<AtomicUsize>,
    /// Best-effort in-process pending estimate (also refreshed from Postgres).
    queued: Arc<AtomicUsize>,
    active: Arc<AtomicUsize>,
    started: Arc<AtomicBool>,
    wake: Arc<Notify>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct IngestPoolStats {
    pub workers: usize,
    pub queued: usize,
    pub active: usize,
    pub max_queue: u32,
    pub saturated: bool,
    pub insert_chunk_size: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubmitResult {
    Queued,
    Saturated { workers: usize, queued: usize, active: usize, max_queue: u32 },
}

/// Pure queue-cap check used by [`IngestWorkerPool::try_reserve`] (and unit tests).
pub fn queue_is_saturated(pending: usize, max_queue: u32) -> bool {
    max_queue > 0 && pending as u32 >= max_queue
}

impl IngestWorkerPool {
    pub fn new(workers: usize, max_queue: u32, insert_chunk_size: usize) -> Self {
        let workers = workers.clamp(1, MAX_INGEST_WORKERS);
        Self {
            configured: Arc::new(AtomicUsize::new(workers)),
            max_queue: Arc::new(AtomicU32::new(max_queue.min(10_000))),
            insert_chunk_size: Arc::new(AtomicUsize::new(
                insert_chunk_size.clamp(1_000, 500_000),
            )),
            queued: Arc::new(AtomicUsize::new(0)),
            active: Arc::new(AtomicUsize::new(0)),
            started: Arc::new(AtomicBool::new(false)),
            wake: Arc::new(Notify::new()),
        }
    }

    pub fn apply_config(&self, workers: usize, max_queue: u32, insert_chunk_size: usize) {
        self.resize(workers);
        self.set_max_queue(max_queue);
        self.set_insert_chunk_size(insert_chunk_size);
    }

    pub fn set_max_queue(&self, max_queue: u32) {
        self.max_queue.store(max_queue.min(10_000), Ordering::SeqCst);
    }

    pub fn set_insert_chunk_size(&self, n: usize) {
        self.insert_chunk_size
            .store(n.clamp(1_000, 500_000), Ordering::SeqCst);
    }

    pub fn insert_chunk_size(&self) -> usize {
        self.insert_chunk_size.load(Ordering::Relaxed)
    }

    /// Spawn waiter tasks (up to [`MAX_INGEST_WORKERS`]). Concurrency is gated by [`Self::resize`].
    pub fn spawn_workers(&self, state: AppState) {
        if self.started.swap(true, Ordering::SeqCst) {
            tracing::warn!("ingest worker pool already started");
            return;
        }

        for worker_id in 0..MAX_INGEST_WORKERS {
            let state = state.clone();
            let active = self.active.clone();
            let configured = self.configured.clone();
            let queued = self.queued.clone();
            let wake = self.wake.clone();
            tokio::spawn(async move {
                loop {
                    // Wait for a free concurrency slot (admin-tunable).
                    loop {
                        let max = configured.load(Ordering::SeqCst).max(1);
                        let cur = active.load(Ordering::SeqCst);
                        if cur < max
                            && active
                                .compare_exchange(cur, cur + 1, Ordering::SeqCst, Ordering::SeqCst)
                                .is_ok()
                        {
                            break;
                        }
                        tokio::time::sleep(Duration::from_millis(40)).await;
                    }

                    let claimed = match state.ingest_jobs.claim_next_pending().await {
                        Ok(job) => job,
                        Err(e) => {
                            active.fetch_sub(1, Ordering::SeqCst);
                            tracing::error!(worker_id, error = %e, "ingest claim_next_pending failed");
                            tokio::time::sleep(Duration::from_millis(500)).await;
                            continue;
                        }
                    };

                    let Some(job) = claimed else {
                        active.fetch_sub(1, Ordering::SeqCst);
                        // Idle: wait for notify or poll interval.
                        tokio::select! {
                            _ = wake.notified() => {}
                            _ = tokio::time::sleep(Duration::from_millis(750)) => {}
                        }
                        continue;
                    };

                    let pending = state.ingest_jobs.count_pending().await.unwrap_or(0);
                    queued.store(pending.max(0) as usize, Ordering::Relaxed);

                    tracing::info!(
                        worker_id,
                        job_id = %job.id,
                        active = active.load(Ordering::Relaxed),
                        queued = queued.load(Ordering::Relaxed),
                        workers = configured.load(Ordering::Relaxed),
                        "ingest worker claimed job"
                    );
                    process_ingest_job(state.clone(), job.id).await;
                    active.fetch_sub(1, Ordering::SeqCst);

                    let pending = state.ingest_jobs.count_pending().await.unwrap_or(0);
                    queued.store(pending.max(0) as usize, Ordering::Relaxed);
                }
            });
        }

        tracing::info!(
            workers = self.configured.load(Ordering::Relaxed),
            max_waiters = MAX_INGEST_WORKERS,
            max_queue = self.max_queue.load(Ordering::Relaxed),
            "ingest worker pool started (postgres claim)"
        );
    }

    pub fn resize(&self, workers: usize) {
        let n = workers.clamp(1, MAX_INGEST_WORKERS);
        let prev = self.configured.swap(n, Ordering::SeqCst);
        if prev != n {
            tracing::info!(from = prev, to = n, "ingest worker concurrency updated");
            self.wake.notify_waiters();
        }
    }

    pub fn workers(&self) -> usize {
        self.configured.load(Ordering::Relaxed)
    }

    pub fn stats(&self) -> IngestPoolStats {
        let max_queue = self.max_queue.load(Ordering::Relaxed);
        let queued = self.queued.load(Ordering::Relaxed);
        IngestPoolStats {
            workers: self.configured.load(Ordering::Relaxed),
            queued,
            active: self.active.load(Ordering::Relaxed),
            max_queue,
            saturated: max_queue > 0 && queued as u32 >= max_queue,
            insert_chunk_size: self.insert_chunk_size.load(Ordering::Relaxed),
        }
    }

    /// Check queue depth before marking a job pending. Refreshes from Postgres when possible.
    pub async fn try_reserve(&self, state: &AppState) -> SubmitResult {
        let pending = match state.ingest_jobs.count_pending().await {
            Ok(n) => n.max(0) as usize,
            Err(_) => self.queued.load(Ordering::Relaxed),
        };
        self.queued.store(pending, Ordering::Relaxed);
        self.evaluate_pending(pending)
    }

    /// Evaluate whether `pending` jobs would be accepted under the current max_queue.
    pub fn evaluate_pending(&self, pending: usize) -> SubmitResult {
        let max_queue = self.max_queue.load(Ordering::SeqCst);
        if queue_is_saturated(pending, max_queue) {
            SubmitResult::Saturated {
                workers: self.configured.load(Ordering::Relaxed),
                queued: pending,
                active: self.active.load(Ordering::Relaxed),
                max_queue,
            }
        } else {
            SubmitResult::Queued
        }
    }

    /// Wake idle workers after a job was marked `pending`.
    pub fn submit(&self, _job_id: Uuid) {
        self.queued.fetch_add(1, Ordering::Relaxed);
        self.wake.notify_one();
    }

    pub async fn recover_interrupted(&self, state: &AppState) {
        match state.ingest_jobs.list_recoverable().await {
            Ok(jobs) if jobs.is_empty() => {
                tracing::info!("ingest pool: no interrupted jobs to recover");
            }
            Ok(jobs) => {
                tracing::warn!(
                    count = jobs.len(),
                    "ingest pool: re-queueing interrupted/pending jobs"
                );
                for job in jobs {
                    if job.status == "running" {
                        if let Err(e) = state.ingest_jobs.mark_pending(job.id).await {
                            tracing::error!(job_id = %job.id, error = %e, "failed to re-pending job");
                            continue;
                        }
                    }
                    self.submit(job.id);
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "ingest pool: failed to list recoverable jobs");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn queue_saturation_respects_unlimited() {
        assert!(!queue_is_saturated(0, 0));
        assert!(!queue_is_saturated(10_000, 0));
    }

    #[test]
    fn queue_saturation_at_cap() {
        assert!(!queue_is_saturated(1, 2));
        assert!(queue_is_saturated(2, 2));
        assert!(queue_is_saturated(3, 2));
    }

    #[test]
    fn pool_clamps_workers_and_chunk_on_construct() {
        let pool = IngestWorkerPool::new(0, 50, 10);
        assert_eq!(pool.workers(), 1);
        assert_eq!(pool.insert_chunk_size(), 1_000);
        let stats = pool.stats();
        assert_eq!(stats.max_queue, 50);
        assert!(!stats.saturated);
    }

    #[test]
    fn pool_apply_config_and_submit_updates_stats() {
        let pool = IngestWorkerPool::new(2, 2, 25_000);
        pool.apply_config(8, 2, 50_000);
        assert_eq!(pool.workers(), 8);
        assert_eq!(pool.insert_chunk_size(), 50_000);

        assert_eq!(pool.evaluate_pending(0), SubmitResult::Queued);
        assert_eq!(pool.evaluate_pending(1), SubmitResult::Queued);
        assert!(matches!(
            pool.evaluate_pending(2),
            SubmitResult::Saturated {
                max_queue: 2,
                queued: 2,
                ..
            }
        ));

        pool.submit(Uuid::nil());
        pool.submit(Uuid::nil());
        let stats = pool.stats();
        assert_eq!(stats.queued, 2);
        assert!(stats.saturated);

        pool.set_max_queue(0);
        assert!(!pool.stats().saturated);
        assert_eq!(pool.evaluate_pending(100), SubmitResult::Queued);
    }

    #[test]
    fn pool_resize_clamps_to_max_waiters() {
        let pool = IngestWorkerPool::new(2, 32, 25_000);
        pool.resize(100);
        assert_eq!(pool.workers(), MAX_INGEST_WORKERS);
    }
}

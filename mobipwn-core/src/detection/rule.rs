/// Prevalence-based noise reduction: suppress alerts when artifact is too common.
#[derive(Debug, Clone)]
pub struct PrevalenceGate {
    pub field: String,
    pub value: String,
    pub prevalence: f64,
    pub threshold: f64,
}

pub fn evaluate_prevalence_gate(gate: &PrevalenceGate) -> bool {
    // Alert when rarity is below threshold (uncommon = interesting).
    gate.prevalence <= gate.threshold
}

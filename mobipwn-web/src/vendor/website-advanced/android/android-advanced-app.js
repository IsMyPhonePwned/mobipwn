import init, { Adb, generate_keypair, has_keypair } from "../../webadb/webadb_rs.js";

let adb = null;
let currentReport = null;
let currentLog = null;

const ADB_USB_FILTERS = Object.freeze([
    { classCode: 0xff, subclassCode: 0x42, protocolCode: 0x01 },
]);

async function requestAdbUsbDeviceFromUser() {
    if (!navigator.usb) {
        throw new Error('WebUSB is not supported. Use Chrome or Edge on desktop over HTTPS.');
    }
    return navigator.usb.requestDevice({ filters: ADB_USB_FILTERS });
}

// Operation queue to prevent concurrent access
let operationQueue = [];
let isProcessingQueue = false;
let queueProcessingStartTime = null;
let queueWatchdogInterval = null;

// Watchdog to detect stuck queues
function startQueueWatchdog() {
    if (queueWatchdogInterval) {
        clearInterval(queueWatchdogInterval);
    }
    
    queueWatchdogInterval = setInterval(() => {
        if (isProcessingQueue && queueProcessingStartTime) {
            const stuckTime = Date.now() - queueProcessingStartTime;
            // If queue has been processing for more than 10 minutes, something is wrong
            if (stuckTime > 10 * 60 * 1000) {
                console.error(`[Queue] WARNING: Queue appears to be stuck! Processing for ${formatDuration(stuckTime)}`);
                console.error(`[Queue] Queue state: isProcessing=${isProcessingQueue}, queueLength=${operationQueue.length}, resetting...`);
                resetQueue();
            } else if (stuckTime > 2 * 60 * 1000) {
                // Warn after 2 minutes
                console.warn(`[Queue] Queue has been processing for ${formatDuration(stuckTime)}. This might be normal for long operations.`);
            }
        } else if (isProcessingQueue && !queueProcessingStartTime) {
            // Queue says it's processing but we don't have a start time - reset
            console.error(`[Queue] WARNING: Queue state inconsistent! isProcessing=true but no start time. Resetting...`);
            resetQueue();
        }
    }, 30000); // Check every 30 seconds
}

function stopQueueWatchdog() {
    if (queueWatchdogInterval) {
        clearInterval(queueWatchdogInterval);
        queueWatchdogInterval = null;
    }
}

// Reset queue state (emergency recovery)
function resetQueue() {
    console.error(`[Queue] RESET: Resetting queue state`);
    const queueLength = operationQueue.length;
    
    // Reject all pending operations
    operationQueue.forEach((item, index) => {
        try {
            if (item && item.reject) {
                item.reject(new Error('Queue was reset due to stuck state'));
            }
        } catch (e) {
            console.error(`[Queue] Error rejecting queued operation ${index}:`, e);
        }
    });
    
    operationQueue = [];
    isProcessingQueue = false;
    queueProcessingStartTime = null;
    stopQueueWatchdog();
    
    // Hide reset button
    const resetBtn = document.getElementById('resetQueueBtn');
    if (resetBtn) {
        resetBtn.style.display = 'none';
    }
    
    console.error(`[Queue] RESET: Cleared ${queueLength} pending operations. Queue is now empty and ready.`);
    if (queueLength > 0) {
        showError(`Queue was reset. ${queueLength} pending operation(s) were cancelled. Please try again.`);
    } else {
        showSuccess('Queue reset successfully.');
    }
}

// Expose reset function globally for manual recovery (assigned in bootAndroidAdvanced)

// Show/hide reset button based on queue state
function updateResetButtonVisibility() {
    const resetBtn = document.getElementById('resetQueueBtn');
    if (resetBtn) {
        if (isProcessingQueue || operationQueue.length > 0) {
            resetBtn.style.display = 'inline-block';
        } else {
            resetBtn.style.display = 'none';
        }
    }
}

// Helper function to format duration in human-readable format
function formatDuration(ms) {
    if (ms < 1000) {
        return `${ms.toFixed(2)}ms`;
    }
    const seconds = Math.floor(ms / 1000);
    const milliseconds = Math.floor(ms % 1000);
    if (seconds < 60) {
        return `${seconds}s ${milliseconds}ms (${ms.toFixed(2)}ms)`;
    }
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s ${milliseconds}ms (${ms.toFixed(2)}ms)`;
}

function kickProcessQueue() {
    queueMicrotask(() => {
        if (!isProcessingQueue && operationQueue.length > 0) {
            void processQueue();
        }
    });
}

async function queueOperation(operation) {
    const queueId = Math.random().toString(36).substr(2, 9);
    const queueLengthBefore = operationQueue.length;
    console.debug(
        `[Queue] enqueue ${queueId} (depth ${queueLengthBefore}→${queueLengthBefore + 1})`
    );
    return new Promise((resolve, reject) => {
        operationQueue.push({ operation, resolve, reject, queueId });
        const queueLengthAfter = operationQueue.length;
        console.debug(
            `[Queue] queued ${queueId}, length=${queueLengthAfter}, processing=${isProcessingQueue}`
        );

        updateResetButtonVisibility();

        if (isProcessingQueue) {
            // Expected when a second action starts while list_dir / shell / etc. is still running.
            console.debug(
                `[Queue] ${queueId} waiting behind current ADB op (serialized; not an error)`
            );
            if (queueProcessingStartTime) {
                const processingTime = Date.now() - queueProcessingStartTime;
                if (processingTime > 5 * 60 * 1000) {
                    console.warn(
                        `[Queue] WARNING: Queue has been busy for ${formatDuration(processingTime)} — possible stuck ADB call. Use "Reset Queue" if needed.`
                    );
                    const resetBtn = document.getElementById('resetQueueBtn');
                    if (resetBtn) resetBtn.style.display = 'inline-block';
                }
            }
        } else {
            console.debug(`[Queue] schedule drain (${queueId})`);
        }

        kickProcessQueue();
    });
}

async function processQueue() {
    if (isProcessingQueue) {
        console.debug('[Queue] skip duplicate processQueue runner');
        return;
    }
    if (operationQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;
    queueProcessingStartTime = Date.now();
    let processed = 0;

    try {
        startQueueWatchdog();
        updateResetButtonVisibility();
        console.debug(`[Queue] drain start, ${operationQueue.length} pending`);

        const maxIterations = 1000;
        let iterations = 0;

        try {
            while (operationQueue.length > 0 && iterations < maxIterations) {
                iterations++;
                const queueItem = operationQueue.shift();
                if (!queueItem) {
                    console.warn('[Queue] Shifted empty queue item, breaking');
                    break;
                }

                const { operation, resolve, reject, queueId } = queueItem;
                processed++;
                const totalOps = processed + operationQueue.length;
                const itemId = queueId || `op-${processed}`;
                console.debug(
                    `[Queue] run ${processed}/${totalOps} (${itemId}, ${operationQueue.length} waiting)`
                );
                const startTime = performance.now();

                let timeoutId = null;
                try {
                    const operationPromise = Promise.resolve(operation());
                    const operationStr = operation.toString();
                    const isLongOperation =
                        operationStr.includes('bugreport') ||
                        operationStr.includes('Bugreport') ||
                        operationStr.includes('bugreport()');
                    const isShellish =
                        operationStr.includes('.shell(') || operationStr.includes('adb.shell');
                    let timeoutMs = 5 * 60 * 1000;
                    if (isLongOperation) timeoutMs = 15 * 60 * 1000;
                    else if (isShellish) timeoutMs = 3 * 60 * 1000;

                    const timeoutPromise = new Promise((_, timeoutReject) => {
                        timeoutId = setTimeout(() => {
                            timeoutReject(new Error(`Operation timeout after ${formatDuration(timeoutMs)}`));
                        }, timeoutMs);
                    });

                    const result = await Promise.race([operationPromise, timeoutPromise]);

                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }

                    const duration = performance.now() - startTime;
                    console.debug(`[Queue] done ${itemId} in ${formatDuration(duration)}`);
                    try {
                        resolve(result);
                    } catch (resolveError) {
                        console.error(`[Queue] resolve error (id: ${itemId}):`, resolveError);
                    }
                } catch (error) {
                    if (timeoutId) {
                        clearTimeout(timeoutId);
                        timeoutId = null;
                    }
                    const duration = performance.now() - startTime;
                    console.error(`[Queue] Operation ${processed} (id: ${itemId}) failed after ${formatDuration(duration)}:`, error);
                    try {
                        reject(error);
                    } catch (rejectError) {
                        console.error(`[Queue] reject error:`, rejectError);
                    }
                }

                if (operationQueue.length > 0) {
                    await new Promise((r) => setTimeout(r, 0));
                }
            }

            if (iterations >= maxIterations) {
                console.error(`[Queue] Max iterations (${maxIterations}), stopping`);
            }
            if (operationQueue.length > 0) {
                console.warn(`[Queue] ${operationQueue.length} operation(s) still queued after loop stop`);
            }

            const processingDuration = queueProcessingStartTime ? Date.now() - queueProcessingStartTime : 0;
            console.debug(
                `[Queue] drain pass done, ${processed} op(s) in ${formatDuration(processingDuration)}`
            );
        } catch (error) {
            console.error('[Queue] Fatal error in drain loop:', error);
            if (error && error.stack) console.error(error.stack);
            showError(`Queue processing error: ${error.message}. Pending work was cleared.`);
            operationQueue.forEach((item) => {
                try {
                    if (item && item.reject) item.reject(error);
                } catch (e) {
                    /* ignore */
                }
            });
            operationQueue = [];
        }
    } finally {
        isProcessingQueue = false;
        queueProcessingStartTime = null;
        stopQueueWatchdog();
        updateResetButtonVisibility();

        if (operationQueue.length > 0) {
            console.debug(
                `[Queue] ${operationQueue.length} still pending — schedule next drain`
            );
            kickProcessQueue();
        } else {
            console.debug('[Queue] idle');
        }
    }
}

// Shell state
let commandHistory = [];
let historyIndex = -1;
let isExecuting = false;

// Shell functions
async function executeShellCommand() {
    const input = document.getElementById('shellInput');
    const output = document.getElementById('terminalOutput');
    const command = input.value.trim();
    
    console.log(`[Shell] executeShellCommand called with command: "${command}"`);
    
    if (!command) {
        console.log('[Shell] Empty command, returning');
        return;
    }
    if (isExecuting) {
        console.log('[Shell] Already executing, returning');
        return;
    }
    
    // Add to history
    if (commandHistory.length === 0 || commandHistory[commandHistory.length - 1] !== command) {
        commandHistory.push(command);
    }
    historyIndex = commandHistory.length;
    
    // Display command
    appendTerminal(`$ ${command}\n`, 'var(--aad-accent, #86efac)');
    input.value = '';
    input.disabled = true;
    isExecuting = true;
    
    const startTime = performance.now();
    console.log(`[Shell] Executing command: "${command}"`);
    
    try {
        const result = await queueOperation(async () => {
            console.log(`[Shell] Calling adb.shell("${command}")`);
            const shellResult = await adb.shell(command);
            console.log(`[Shell] Command completed, result length: ${shellResult.length} chars`);
            return shellResult;
        });
        const duration = performance.now() - startTime;
        console.log(`[Shell] Command executed successfully in ${formatDuration(duration)}`);
        appendTerminal(result + '\n', 'var(--aad-text, #d4d4d4)');
    } catch (error) {
        const duration = performance.now() - startTime;
        console.error(`[Shell] Command failed after ${formatDuration(duration)}:`, error);
        appendTerminal(`Error: ${error}\n`, 'var(--aad-danger, #ff6b6b)');
    } finally {
        input.disabled = false;
        input.focus();
        isExecuting = false;
    }
}

function executeQuickCommand(command) {
    const input = document.getElementById('shellInput');
    input.value = command;
    executeShellCommand();
}

function appendTerminal(text, color = 'var(--aad-text, #d4d4d4)') {
    const output = document.getElementById('terminalOutput');
    const span = document.createElement('span');
    span.style.color = color;
    span.textContent = text;
    output.appendChild(span);
    output.scrollTop = output.scrollHeight;
}

function clearTerminal() {
    const output = document.getElementById('terminalOutput');
    output.innerHTML = '$ <span class="terminal-muted">Terminal cleared. Ready for commands.</span>';
}

function handleShellKeydown(event) {
    const input = document.getElementById('shellInput');
    
    // Enter key
    if (event.key === 'Enter') {
        event.preventDefault();
        executeShellCommand();
        return;
    }
    
    // Up arrow - previous command
    if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (historyIndex > 0) {
            historyIndex--;
            input.value = commandHistory[historyIndex];
        }
        return;
    }
    
    // Down arrow - next command
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (historyIndex < commandHistory.length - 1) {
            historyIndex++;
            input.value = commandHistory[historyIndex];
        } else {
            historyIndex = commandHistory.length;
            input.value = '';
        }
        return;
    }
    
    // Ctrl+C - clear input
    if (event.ctrlKey && event.key === 'c') {
        event.preventDefault();
        input.value = '';
        return;
    }
    
    // Ctrl+L - clear terminal
    if (event.ctrlKey && event.key === 'l') {
        event.preventDefault();
        clearTerminal();
        return;
    }
}

// File Manager State
let currentPath = '/sdcard';
let fileList = [];
let selectedFiles = new Set();
let fileHistory = [];
let fileHistoryIndex = -1;
let contextMenuTarget = null;
let renameTarget = null;
let sortBy = 'name';
let sortAsc = true;

// File Manager Functions
async function navigateToPath(path) {
    try {
        currentPath = path;
        fileHistory.push(path);
        fileHistoryIndex = fileHistory.length - 1;
        await refreshFileList();
        updateNavigationButtons();
    } catch (error) {
        showError('Failed to navigate: ' + error);
    }
}

async function refreshFileList() {
    console.log(`[FileManager] refreshFileList called for path: ${currentPath}`);
    const startTime = performance.now();
    try {
        const entries = await queueOperation(async () => {
            console.log(`[FileManager] Calling adb.list_directory("${currentPath}")`);
            const result = await adb.list_directory(currentPath);
            console.log(`[FileManager] Received ${result.length} directory entries`);
            return result;
        });
        const duration = performance.now() - startTime;
        console.log(`[FileManager] Directory listing completed in ${formatDuration(duration)}`);
        fileList = entries;
        selectedFiles.clear();
        renderFileList();
        renderBreadcrumb();
    } catch (error) {
        const duration = performance.now() - startTime;
        console.error(`[FileManager] Failed after ${formatDuration(duration)}:`, error);
        showError('Failed to list directory: ' + error);
        document.getElementById('fileTableBody').innerHTML = `
            <tr><td colspan="4" class="empty-cell empty-cell--error">
                Error loading directory: ${error}
            </td></tr>
        `;
    }
}

function renderFileList() {
    const tbody = document.getElementById('fileTableBody');
    const sortedList = sortFileList([...fileList]);
    
    if (sortedList.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="4" class="empty-cell">
                This directory is empty
            </td></tr>
        `;
        return;
    }

    tbody.innerHTML = sortedList.map((entry, index) => {
        const isDir = entry.is_directory;
        const icon = getFileIcon(entry);
        const size = isDir ? '-' : formatFileSize(entry.size);
        const type = isDir ? 'Folder' : getFileType(entry.name);
        const fullPath = currentPath.endsWith('/') ? currentPath + entry.name : currentPath + '/' + entry.name;
        const isSelected = selectedFiles.has(fullPath);
        
        return `
            <tr class="${isSelected ? 'selected' : ''}" data-path="${fullPath}" data-index="${index}">
                <td>
                    <div class="file-row-name">
                        <input type="checkbox" class="file-checkbox" data-path="${fullPath}" ${isSelected ? 'checked' : ''} onclick="toggleFileSelection('${fullPath}', event)">
                        <span class="file-icon-large">${icon}</span>
                        <span class="file-name-link" onclick="handleFileClick('${fullPath}', ${isDir})">${entry.name}</span>
                    </div>
                </td>
                <td class="col-size">${size}</td>
                <td>${type}</td>
                <td class="col-actions">
                    <button type="button" class="btn btn-primary file-action-btn" onclick="handleFileAction('${fullPath}', '${isDir ? 'open' : 'download'}')">
                        ${isDir ? 'Open' : 'Download'}
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    // Add right-click listeners
    tbody.querySelectorAll('tr[data-path]').forEach(row => {
        row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, row.dataset.path);
        });
    });
}

function renderBreadcrumb() {
    const nav = document.getElementById('breadcrumbNav');
    const parts = currentPath.split('/').filter(p => p);
    
    let html = '<span class="breadcrumb-part" onclick="navigateToPath(\'/\')">root</span>';
    let path = '';
    
    parts.forEach((part, index) => {
        path += '/' + part;
        const currentPath = path;
        html += `<span class="breadcrumb-separator">/</span>`;
        html += `<span class="breadcrumb-part" onclick="navigateToPath('${currentPath}')">${part}</span>`;
    });
    
    nav.innerHTML = html;
}

function sortFileList(list) {
    return list.sort((a, b) => {
        // Folders first
        if (a.is_directory && !b.is_directory) return -1;
        if (!a.is_directory && b.is_directory) return 1;
        
        // Then by sort field
        let aVal, bVal;
        if (sortBy === 'name') {
            aVal = a.name.toLowerCase();
            bVal = b.name.toLowerCase();
        } else if (sortBy === 'size') {
            aVal = a.size || 0;
            bVal = b.size || 0;
        }
        
        if (aVal < bVal) return sortAsc ? -1 : 1;
        if (aVal > bVal) return sortAsc ? 1 : -1;
        return 0;
    });
}

function getFileIcon(entry) {
    if (entry.is_directory) return '📁';
    
    const ext = entry.name.split('.').pop().toLowerCase();
    const iconMap = {
        // Images
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'webp': '🖼️', 'bmp': '🖼️',
        // Videos
        'mp4': '🎬', 'avi': '🎬', 'mkv': '🎬', 'mov': '🎬', 'wmv': '🎬',
        // Audio
        'mp3': '🎵', 'wav': '🎵', 'm4a': '🎵', 'flac': '🎵', 'ogg': '🎵',
        // Documents
        'pdf': '📄', 'doc': '📄', 'docx': '📄', 'txt': '📝', 'log': '📝',
        // Archives
        'zip': '📦', 'rar': '📦', 'tar': '📦', 'gz': '📦', '7z': '📦', 'apk': '📦',
        // Code
        'js': '📜', 'html': '📜', 'css': '📜', 'json': '📜', 'xml': '📜',
    };
    
    return iconMap[ext] || '📄';
}

function getFileType(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const typeMap = {
        'jpg': 'Image', 'jpeg': 'Image', 'png': 'Image', 'gif': 'Image',
        'mp4': 'Video', 'avi': 'Video', 'mkv': 'Video',
        'mp3': 'Audio', 'wav': 'Audio', 'm4a': 'Audio',
        'pdf': 'PDF', 'txt': 'Text', 'log': 'Log',
        'zip': 'Archive', 'apk': 'APK',
    };
    return typeMap[ext] || 'File';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

async function handleFileClick(path, isDirectory) {
    if (isDirectory) {
        await navigateToPath(path);
    } else {
        await downloadFile(path);
    }
}

async function handleFileAction(path, action) {
    if (action === 'open') {
        await navigateToPath(path);
    } else if (action === 'download') {
        await downloadFile(path);
    }
}

async function downloadFile(path) {
    try {
        showSuccess('Downloading: ' + path.split('/').pop());
        const data = await queueOperation(async () => {
            return await adb.pull_file(path);
        });
        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop();
        a.click();
        URL.revokeObjectURL(url);
        showSuccess('Downloaded: ' + path.split('/').pop());
    } catch (error) {
        showError('Download failed: ' + error);
    }
}

async function uploadFiles(files) {
    const modal = document.getElementById('uploadProgressModal');
    const fileName = document.getElementById('uploadFileName');
    const progressBar = document.getElementById('uploadProgressBar');
    const progressText = document.getElementById('uploadProgressText');
    const status = document.getElementById('uploadStatus');
    
    modal.style.display = 'flex';
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        fileName.textContent = `${file.name} (${i + 1}/${files.length})`;
        status.textContent = 'Reading file...';
        
        try {
            const arrayBuffer = await file.arrayBuffer();
            const data = new Uint8Array(arrayBuffer);
            
            status.textContent = 'Uploading...';
            const remotePath = currentPath.endsWith('/') ? 
                currentPath + file.name : 
                currentPath + '/' + file.name;
            
            // wasm-bindgen automatically converts Uint8Array to Vec<u8>
            await queueOperation(async () => {
                return await adb.push_file(data, remotePath);
            });
            
            progressBar.style.width = ((i + 1) / files.length * 100) + '%';
            progressText.textContent = Math.round((i + 1) / files.length * 100) + '%';
            status.textContent = 'Complete!';
            
        } catch (error) {
            showError('Upload failed for ' + file.name + ': ' + error);
            break;
        }
    }
    
    setTimeout(() => {
        modal.style.display = 'none';
        progressBar.style.width = '0%';
        refreshFileList();
    }, 1000);
}

function toggleFileSelection(path, event) {
    if (event) event.stopPropagation();
    
    if (selectedFiles.has(path)) {
        selectedFiles.delete(path);
    } else {
        selectedFiles.add(path);
    }
    
    renderFileList();
}

function selectAllFiles() {
    fileList.forEach(entry => {
        const path = currentPath.endsWith('/') ? currentPath + entry.name : currentPath + '/' + entry.name;
        selectedFiles.add(path);
    });
    renderFileList();
}

function deselectAllFiles() {
    selectedFiles.clear();
    renderFileList();
}

function showContextMenu(event, path) {
    const menu = document.getElementById('fileContextMenu');
    contextMenuTarget = path;
    
    menu.style.display = 'block';
    menu.style.left = event.pageX + 'px';
    menu.style.top = event.pageY + 'px';
}

function hideContextMenu() {
    document.getElementById('fileContextMenu').style.display = 'none';
}

async function handleContextMenuAction(action) {
    hideContextMenu();
    
    if (!contextMenuTarget) return;
    
    const entry = fileList.find(e => {
        const path = currentPath.endsWith('/') ? currentPath + e.name : currentPath + '/' + e.name;
        return path === contextMenuTarget;
    });
    
    switch (action) {
        case 'open':
            if (entry && entry.is_directory) {
                await navigateToPath(contextMenuTarget);
            }
            break;
        case 'download':
            await downloadFile(contextMenuTarget);
            break;
        case 'rename':
            showRenameDialog(contextMenuTarget);
            break;
        case 'delete':
            showDeleteConfirm(contextMenuTarget);
            break;
        case 'copypath':
            navigator.clipboard.writeText(contextMenuTarget);
            showSuccess('Path copied to clipboard');
            break;
    }
}

function showRenameDialog(path) {
    renameTarget = path;
    const name = path.split('/').pop();
    document.getElementById('renameInput').value = name;
    document.getElementById('renameModal').style.display = 'flex';
    document.getElementById('renameInput').focus();
    document.getElementById('renameInput').select();
}

function closeRenameModal() {
    document.getElementById('renameModal').style.display = 'none';
    renameTarget = null;
}

async function confirmRename() {
    const newName = document.getElementById('renameInput').value.trim();
    if (!newName || !renameTarget) return;
    
    const parentPath = renameTarget.substring(0, renameTarget.lastIndexOf('/'));
    const newPath = parentPath + '/' + newName;
    
    try {
        await queueOperation(async () => {
            return await adb.rename_file(renameTarget, newPath);
        });
        showSuccess('Renamed successfully');
        closeRenameModal();
        await refreshFileList();
    } catch (error) {
        showError('Rename failed: ' + error);
    }
}

function showNewFolderDialog() {
    document.getElementById('newFolderInput').value = '';
    document.getElementById('newFolderModal').style.display = 'flex';
    document.getElementById('newFolderInput').focus();
}

function closeNewFolderModal() {
    document.getElementById('newFolderModal').style.display = 'none';
}

async function confirmNewFolder() {
    const name = document.getElementById('newFolderInput').value.trim();
    if (!name) return;
    
    const newPath = currentPath.endsWith('/') ? currentPath + name : currentPath + '/' + name;
    
    try {
        await queueOperation(async () => {
            return await adb.create_directory(newPath);
        });
        showSuccess('Folder created');
        closeNewFolderModal();
        await refreshFileList();
    } catch (error) {
        showError('Create folder failed: ' + error);
    }
}

function showDeleteConfirm(path) {
    const name = path.split('/').pop();
    document.getElementById('deleteConfirmText').textContent = 
        `Are you sure you want to delete "${name}"?`;
    document.getElementById('deleteConfirmModal').style.display = 'flex';
    contextMenuTarget = path;
}

function closeDeleteConfirmModal() {
    document.getElementById('deleteConfirmModal').style.display = 'none';
}

async function confirmDelete() {
    if (!contextMenuTarget) return;
    
    try {
        await queueOperation(async () => {
            return await adb.delete_path(contextMenuTarget);
        });
        showSuccess('Deleted successfully');
        closeDeleteConfirmModal();
        await refreshFileList();
    } catch (error) {
        showError('Delete failed: ' + error);
    }
}

// Inline onclick / innerHTML handlers run in global scope; `type="module"` keeps these local.
window.toggleFileSelection = toggleFileSelection;
window.handleFileClick = handleFileClick;
window.handleFileAction = handleFileAction;
window.navigateToPath = navigateToPath;
window.closeRenameModal = closeRenameModal;
window.confirmRename = confirmRename;
window.closeNewFolderModal = closeNewFolderModal;
window.confirmNewFolder = confirmNewFolder;
window.closeDeleteConfirmModal = closeDeleteConfirmModal;
window.confirmDelete = confirmDelete;

function updateNavigationButtons() {
    document.getElementById('fileNavBack').disabled = fileHistoryIndex <= 0;
    document.getElementById('fileNavUp').disabled = currentPath === '/';
}

async function navigateBack() {
    if (fileHistoryIndex > 0) {
        fileHistoryIndex--;
        currentPath = fileHistory[fileHistoryIndex];
        await refreshFileList();
        updateNavigationButtons();
    }
}

async function navigateUp() {
    if (currentPath === '/') return;
    const parent = currentPath.substring(0, currentPath.lastIndexOf('/')) || '/';
    await navigateToPath(parent);
}

function setupFileManagerListeners() {
    // Navigation
    document.getElementById('fileNavBack').addEventListener('click', navigateBack);
    document.getElementById('fileNavUp').addEventListener('click', navigateUp);
    document.getElementById('fileRefresh').addEventListener('click', refreshFileList);
    
    // Quick paths
    document.querySelectorAll('.quickPath').forEach(btn => {
        btn.addEventListener('click', () => navigateToPath(btn.dataset.path));
    });
    
    // Upload
    document.getElementById('fileUploadBtn').addEventListener('click', () => {
        document.getElementById('fileUploadInput').click();
    });
    
    document.getElementById('fileUploadInput').addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            uploadFiles(Array.from(e.target.files));
            e.target.value = '';
        }
    });
    
    // New folder
    document.getElementById('fileNewFolderBtn').addEventListener('click', showNewFolderDialog);
    
    // Selection
    document.getElementById('fileSelectAllBtn').addEventListener('click', selectAllFiles);
    document.getElementById('fileDeselectAllBtn').addEventListener('click', deselectAllFiles);
    
    // Context menu
    document.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            handleContextMenuAction(item.dataset.action);
        });
    });
    
    // Hide context menu on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#fileContextMenu')) {
            hideContextMenu();
        }
    });
    
    // Drag and drop
    const dropZone = document.getElementById('fileDropZone');
    
    document.addEventListener('dragenter', (e) => {
        if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            dropZone.classList.add('active');
            document.getElementById('dropZonePath').textContent = currentPath;
        }
    });
    
    dropZone.addEventListener('dragleave', (e) => {
        if (e.target === dropZone) {
            dropZone.classList.remove('active');
        }
    });
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
    });
    
    dropZone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('active');
        
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) {
            await uploadFiles(files);
        }
    });
    
    // Sorting
    document.querySelector('th[data-sort="name"]').addEventListener('click', () => {
        if (sortBy === 'name') {
            sortAsc = !sortAsc;
        } else {
            sortBy = 'name';
            sortAsc = true;
        }
        document.getElementById('sortNameIndicator').textContent = sortAsc ? '▼' : '▲';
        document.getElementById('sortSizeIndicator').textContent = '';
        renderFileList();
    });
    
    document.querySelector('th[data-sort="size"]').addEventListener('click', () => {
        if (sortBy === 'size') {
            sortAsc = !sortAsc;
        } else {
            sortBy = 'size';
            sortAsc = true;
        }
        document.getElementById('sortSizeIndicator').textContent = sortAsc ? '▼' : '▲';
        document.getElementById('sortNameIndicator').textContent = '';
        renderFileList();
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Only handle if no modal is open
        if (document.querySelector('.modal[style*="flex"]')) return;
        
        if (e.key === 'F5') {
            e.preventDefault();
            refreshFileList();
        }
        
        if (e.key === 'Delete' && selectedFiles.size > 0) {
            e.preventDefault();
            const firstPath = Array.from(selectedFiles)[0];
            showDeleteConfirm(firstPath);
        }
        
        if (e.key === 'Backspace' && currentPath !== '/') {
            e.preventDefault();
            navigateUp();
        }
    });
    
    // Enter key for rename modal
    document.getElementById('renameInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmRename();
        } else if (e.key === 'Escape') {
            closeRenameModal();
        }
    });
    
    // Enter key for new folder modal
    document.getElementById('newFolderInput').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            confirmNewFolder();
        } else if (e.key === 'Escape') {
            closeNewFolderModal();
        }
    });
}

async function enableFileManager() {
    // Enable all file manager buttons
    document.querySelectorAll('.quickPath').forEach(btn => btn.disabled = false);
    document.getElementById('fileNavBack').disabled = false;
    document.getElementById('fileNavUp').disabled = false;
    document.getElementById('fileRefresh').disabled = false;
    document.getElementById('fileUploadBtn').disabled = false;
    document.getElementById('fileNewFolderBtn').disabled = false;
    document.getElementById('fileSelectAllBtn').disabled = false;
    document.getElementById('fileDeselectAllBtn').disabled = false;
    
    // Load initial directory
    await navigateToPath('/sdcard');
}

function disableFileManager() {
    // Disable all file manager buttons
    document.querySelectorAll('.quickPath').forEach(btn => btn.disabled = true);
    document.getElementById('fileNavBack').disabled = true;
    document.getElementById('fileNavUp').disabled = true;
    document.getElementById('fileRefresh').disabled = true;
    document.getElementById('fileUploadBtn').disabled = true;
    document.getElementById('fileNewFolderBtn').disabled = true;
    document.getElementById('fileSelectAllBtn').disabled = true;
    document.getElementById('fileDeselectAllBtn').disabled = true;
    
    // Clear file list
    document.getElementById('fileTableBody').innerHTML = `
        <tr><td colspan="4" class="empty-cell">
            Connect to a device to browse files
        </td></tr>
    `;
    document.getElementById('breadcrumbNav').innerHTML = '<span class="muted">Not connected</span>';
}



function setupEventListeners() {
    document.getElementById('connectBtn').addEventListener('click', connect);
    document.getElementById('disconnectBtn').addEventListener('click', disconnect);
    
    // Diagnostics
    document.getElementById('healthCheckBtn').addEventListener('click', performHealthCheck);
    document.getElementById('cleanupStreamsBtn').addEventListener('click', cleanupStaleStreams);
    document.getElementById('refreshDiagnosticsBtn').addEventListener('click', refreshDiagnostics);
    
    // Bugreport
    document.getElementById('bugreportLiteBtn').addEventListener('click', generateLiteBugreport);
    document.getElementById('bugreportFullBtn').addEventListener('click', generateFullBugreport);
    document.getElementById('downloadReportBtn').addEventListener('click', downloadReport);
    document.getElementById('viewReportBtn').addEventListener('click', viewReport);
    document.getElementById('listBugreportsBtn').addEventListener('click', listAvailableBugreports);
    
    // Logcat
    document.getElementById('logcatBtn').addEventListener('click', getLogcat);
    document.getElementById('logcatClearBtn').addEventListener('click', clearLogcat);
    document.getElementById('downloadLogBtn').addEventListener('click', downloadLog);
    
    // Files
    document.getElementById('listBtn').addEventListener('click', listDirectory);
    document.getElementById('statBtn').addEventListener('click', statFile);
    
    // Advanced
    document.getElementById('screenshotBtn').addEventListener('click', captureScreenshot);
    document.getElementById('dumpStateBtn').addEventListener('click', dumpState);
    document.getElementById('packageListBtn').addEventListener('click', listPackages);
    
    // Shell
    document.getElementById('shellInput').addEventListener('keydown', handleShellKeydown);
    document.getElementById('shellExecuteBtn').addEventListener('click', executeShellCommand);
    
    // Shell quick commands
    document.getElementById('shellCmdLs').addEventListener('click', () => executeQuickCommand('ls -la'));
    document.getElementById('shellCmdPwd').addEventListener('click', () => executeQuickCommand('pwd'));
    document.getElementById('shellCmdDf').addEventListener('click', () => executeQuickCommand('df -h'));
    document.getElementById('shellCmdPs').addEventListener('click', () => executeQuickCommand('ps'));
    document.getElementById('shellCmdVersion').addEventListener('click', () => executeQuickCommand('getprop | grep version'));
    document.getElementById('shellCmdUname').addEventListener('click', () => executeQuickCommand('uname -a'));
    document.getElementById('shellCmdClear').addEventListener('click', clearTerminal);
    
    // File Manager
    setupFileManagerListeners();
}

async function connect() {
    console.log('[Connect] Starting connection...');
    const startTime = performance.now();
    try {
        updateStatus('working', 'Connecting...');
        console.log('[Connect] Requesting device and connecting...');
        // WebUSB: `requestDevice` must run in the user-gesture turn. First await here is
        // `requestAdbUsbDeviceFromUser()`, not `adb.connect()` (WASM would defer WebUSB).
        console.log('[Connect] requestDevice (JS) then adb.connectWithUsbDevice()');
        const usbDevice = await requestAdbUsbDeviceFromUser();
        const deviceInfo = await adb.connectWithUsbDevice(usbDevice);
        console.log('[Connect] connectWithUsbDevice completed, device info:', deviceInfo);
        const duration = performance.now() - startTime;
        console.log(`[Connect] Connection successful in ${formatDuration(duration)}`);
        updateStatus('connected', 'Connected');
        enableButtons();
        console.log('[Connect] Buttons enabled, refreshing diagnostics...');
        await refreshDiagnostics();
        
        // Show terminal welcome
        clearTerminal();
        appendTerminal('='.repeat(60) + '\n', 'var(--aad-accent, #86efac)');
        appendTerminal('  Android Device Shell - WebADB\n', 'var(--aad-accent, #86efac)');
        appendTerminal('='.repeat(60) + '\n', 'var(--aad-accent, #86efac)');
        
        try {
            // Try to get properties via get_properties API
            let model = 'Unknown';
            let android = 'Unknown';
            let build = 'Unknown';
            
            try {
                const props = await queueOperation(async () => {
                    return await adb.get_properties();
                });
                
                // Properties are returned as a JavaScript object from HashMap via serde_wasm_bindgen
                // The object should be directly accessible
                if (props && typeof props === 'object') {
                    // Access properties using bracket notation (HashMap keys with dots)
                    model = props['ro.product.model'] || props['ro.product.name'] || model;
                    android = props['ro.build.version.release'] || props['ro.build.version.sdk'] || android;
                    build = props['ro.build.id'] || props['ro.build.display.id'] || build;
                }
            } catch (propError) {
                console.warn('get_properties failed, trying shell fallback:', propError);
            }
            
            // Fallback: if properties are still unknown, try shell commands
            if (model === 'Unknown' || android === 'Unknown' || build === 'Unknown') {
                try {
                    if (model === 'Unknown') {
                        const modelResult = await queueOperation(async () => {
                            return await adb.shell('getprop ro.product.model');
                        });
                        model = modelResult.trim() || 'Unknown';
                    }
                    if (android === 'Unknown') {
                        const androidResult = await queueOperation(async () => {
                            return await adb.shell('getprop ro.build.version.release');
                        });
                        android = androidResult.trim() || 'Unknown';
                    }
                    if (build === 'Unknown') {
                        const buildResult = await queueOperation(async () => {
                            return await adb.shell('getprop ro.build.id');
                        });
                        build = buildResult.trim() || 'Unknown';
                    }
                } catch (shellError) {
                    console.warn('Shell fallback failed:', shellError);
                }
            }
            
            appendTerminal(`\n Device: ${model}\n`, '#d4d4d4');
            appendTerminal(` Android: ${android}\n`, '#d4d4d4');
            appendTerminal(` Build: ${build}\n\n`, '#d4d4d4');
        } catch (e) {
            console.error('Error getting device info:', e);
            appendTerminal('\n Device connected!\n\n', '#d4d4d4');
        }
        
        appendTerminal('$ ', 'var(--aad-accent, #86efac)');
        
        // Enable file manager
        await enableFileManager();
    } catch (error) {
        updateStatus('disconnected', 'Connection failed');
        alert('Failed to connect: ' + error);
    }
}

async function waitForQueueIdle(maxMs) {
    const t0 = Date.now();
    while (isProcessingQueue && Date.now() - t0 < maxMs) {
        await new Promise((r) => setTimeout(r, 40));
    }
    if (isProcessingQueue) {
        console.warn('[Disconnect] Queue still marked busy after wait; forcing resetQueue()');
        resetQueue();
    }
}

async function disconnect() {
    console.log('[Disconnect] Starting disconnect...');
    const startTime = performance.now();
    const btn = document.getElementById('disconnectBtn');
    try {
        btn.disabled = true;
        btn.textContent = 'Disconnecting...';

        const pending = operationQueue.splice(0);
        console.log(`[Disconnect] Rejecting ${pending.length} queued (not yet running) operation(s)`);
        pending.forEach((item) => {
            try {
                if (item && item.reject) {
                    item.reject(new Error('Disconnected from device'));
                }
            } catch (e) {
                /* ignore */
            }
        });

        console.log('[Disconnect] Waiting for in-flight ADB queue to finish (or reset)...');
        await waitForQueueIdle(15000);

        if (adb) {
            console.log('[Disconnect] Calling adb.disconnect()');
            try {
                await adb.disconnect();
                console.log('[Disconnect] adb.disconnect() completed successfully');
            } catch (disconnectError) {
                console.warn('[Disconnect] Disconnect error (may be already disconnected):', disconnectError);
            }
        } else {
            console.log('[Disconnect] adb is null, skipping disconnect call');
        }

        stopQueueWatchdog();
        isProcessingQueue = false;
        queueProcessingStartTime = null;
        operationQueue = [];
        
        const duration = performance.now() - startTime;
        console.log(`[Disconnect] Disconnect completed in ${formatDuration(duration)}`);
        updateStatus('disconnected', 'Disconnected');
        disableButtons();
        disableFileManager();
        
        // Clear terminal
        clearTerminal();
        
    } catch (error) {
        const duration = performance.now() - startTime;
        console.error(`[Disconnect] Disconnect failed after ${formatDuration(duration)}:`, error);
        alert('Failed to disconnect: ' + error);
        // Still try to reset state
        isProcessingQueue = false;
        operationQueue = [];
        disableButtons();
        disableFileManager();
    } finally {
        btn.disabled = false;
        btn.textContent = 'Disconnect';
    }
}

// Diagnostics functions
async function refreshDiagnostics() {
    try {
        if (!adb) return;
        // Intentionally not queued: lightweight read; avoids stacking work right after connect.
        const count = adb.active_stream_count();
        document.getElementById('streamCount').textContent = count;
        
        const log = document.getElementById('diagnosticsLog');
        log.style.display = 'block';
        const time = new Date().toLocaleTimeString();
        log.innerHTML = `<div class="diag-info">[${time}] Refreshed - ${count} active stream(s)</div>` + log.innerHTML;
    } catch (error) {
        showError('Refresh failed: ' + error);
    }
}

async function performHealthCheck() {
    const btn = document.getElementById('healthCheckBtn');
    const status = document.getElementById('healthStatus');
    const log = document.getElementById('diagnosticsLog');
    
    try {
        btn.disabled = true;
        btn.textContent = 'Checking...';
        status.textContent = '...';
        status.className = 'stat-card__value stat-card__value--sm';
        status.style.color = '';
        
        const healthy = await queueOperation(async () => {
            return await adb.health_check();
        });
        
        const time = new Date().toLocaleTimeString();
        log.style.display = 'block';
        
        if (healthy) {
            status.textContent = 'Healthy';
            status.className = 'stat-card__value stat-card__value--sm diag-ok';
            log.innerHTML = `<div class="diag-ok">[${time}] Health check PASSED</div>` + log.innerHTML;
            showSuccess('Device is responding');
        } else {
            status.textContent = 'Unhealthy';
            status.className = 'stat-card__value stat-card__value--sm diag-err';
            log.innerHTML = `<div class="diag-err">[${time}] Health check FAILED</div>` + log.innerHTML;
            showWarning('Device not responding properly');
        }
        
        await refreshDiagnostics();
    } catch (error) {
        status.textContent = 'Error';
        status.className = 'stat-card__value stat-card__value--sm diag-err';
        showError('Health check error: ' + error);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Check Health';
    }
}

async function cleanupStaleStreams() {
    const btn = document.getElementById('cleanupStreamsBtn');
    const countEl = document.getElementById('cleanedCount');
    const log = document.getElementById('diagnosticsLog');
    
    try {
        btn.disabled = true;
        btn.textContent = 'Cleaning...';
        
        const cleaned = await queueOperation(async () => {
            return await adb.cleanup_stale_streams();
        });
        const total = parseInt(countEl.textContent) + cleaned;
        countEl.textContent = total;
        
        const time = new Date().toLocaleTimeString();
        log.style.display = 'block';
        log.innerHTML = `<div class="diag-warn">[${time}] Cleaned ${cleaned} stale stream(s)</div>` + log.innerHTML;
        
        if (cleaned > 0) {
            showSuccess(`Cleaned ${cleaned} stale stream(s)`);
        } else {
            showSuccess('No stale streams found');
        }
        
        await refreshDiagnostics();
    } catch (error) {
        showError('Cleanup failed: ' + error);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Cleanup Stale';
    }
}

async function generateLiteBugreport() {
    const btn = document.getElementById('bugreportLiteBtn');
    const output = document.getElementById('bugreportOutput');
    const info = document.getElementById('bugreportInfo');
    
    try {
        btn.disabled = true;
        btn.textContent = 'Generating...';
        output.style.display = 'block';
        output.textContent = 'Generating lite bugreport...';
        
        const report = await queueOperation(async () => {
            return await adb.bugreport_lite();
        });
        
        currentReport = new Blob([report], { type: 'text/plain' });
        
        output.textContent = report;
        info.classList.add('show');
        document.getElementById('reportSize').textContent = formatBytes(report.length);
        document.getElementById('reportFormat').textContent = 'Text';
        
        showSuccess('Lite bugreport generated successfully!');
    } catch (error) {
        output.textContent = 'Error: ' + error;
        showError('Failed to generate bugreport: ' + error);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Generate Lite Report (Fast)';
    }
}

async function generateFullBugreport() {
    const btn = document.getElementById('bugreportFullBtn');
    const progress = document.getElementById('bugreportProgress');
    const progressBar = document.getElementById('bugreportProgressBar');
    const output = document.getElementById('bugreportOutput');
    const info = document.getElementById('bugreportInfo');
    const detail = document.getElementById('bugreportFullDetail');
    const elapsedEl = document.getElementById('bugreportElapsed');

    let progressInterval = null;
    let elapsedInterval = null;
    const t0 = Date.now();

    const stopTimers = () => {
        if (progressInterval) {
            clearInterval(progressInterval);
            progressInterval = null;
        }
        if (elapsedInterval) {
            clearInterval(elapsedInterval);
            elapsedInterval = null;
        }
    };

    const tickElapsed = () => {
        const sec = Math.floor((Date.now() - t0) / 1000);
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        elapsedEl.textContent = `Elapsed: ${m}:${s.toString().padStart(2, '0')}`;
    };

    try {
        btn.disabled = true;
        btn.textContent = 'Generating… (typically 5–15 min)';
        progress.classList.add('show');
        progressBar.style.width = '10%';
        progressBar.textContent = 'Starting…';
        output.style.display = 'none';
        detail.style.display = 'block';
        tickElapsed();
        elapsedInterval = setInterval(tickElapsed, 1000);

        showWarning(
            'Full bugreport started. The phone collects diagnostics for several minutes, then the ZIP is downloaded. See the details below.'
        );

        // Approximate progress only — ADB does not expose real percentages
        progressInterval = setInterval(() => {
            const current = parseInt(progressBar.style.width, 10) || 0;
            if (current < 88) {
                const next = Math.min(88, current + 4);
                progressBar.style.width = next + '%';
                progressBar.textContent = next + '%';
            }
        }, 4000);

        const reportData = await queueOperation(async () => {
            return await adb.bugreport();
        });

        stopTimers();
        progressBar.style.width = '100%';
        progressBar.textContent = '100%';

        currentReport = new Blob([reportData], { type: 'application/zip' });

        info.classList.add('show');
        document.getElementById('reportSize').textContent = formatBytes(reportData.byteLength);
        document.getElementById('reportFormat').textContent = 'ZIP Archive';

        const elapsedMs = Date.now() - t0;
        showSuccess(
            `Full bugreport ready — ${formatBytes(reportData.byteLength)} in ${formatDuration(elapsedMs)}. You can download below.`
        );

        setTimeout(() => {
            progress.classList.remove('show');
        }, 2000);
    } catch (error) {
        stopTimers();
        showError('Failed to generate bugreport: ' + error);
        progress.classList.remove('show');
    } finally {
        detail.style.display = 'none';
        btn.disabled = false;
        btn.textContent = 'Generate Full Report (Very Slow ~5-10min)';
    }
}

function downloadReport() {
    if (!currentReport) return;
    
    const url = URL.createObjectURL(currentReport);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bugreport-' + new Date().getTime() + 
                 (currentReport.type.includes('zip') ? '.zip' : '.txt');
    a.click();
    URL.revokeObjectURL(url);
}

function viewReport() {
    const output = document.getElementById('bugreportOutput');
    if (currentReport && currentReport.type === 'text/plain') {
        output.style.display = 'block';
        currentReport.text().then(text => {
            output.textContent = text;
        });
    } else {
        alert('Binary reports cannot be viewed in browser. Please download.');
    }
}

async function listAvailableBugreports() {
    const btn = document.getElementById('listBugreportsBtn');
    const output = document.getElementById('bugreportsList');
    
    try {
        btn.disabled = true;
        btn.textContent = 'Searching...';
        output.style.display = 'block';
        output.textContent = 'Searching for bugreports on device...';
        
        const paths = await queueOperation(async () => {
            return await adb.list_bugreports();
        });
        
        if (paths.length === 0) {
            output.innerHTML = '<span class="muted">No bugreports found on device.</span>';
            showWarning('No bugreports found. Generate one first using "Generate Full Report".');
            return;
        }
        
        let html = `<div class="diag-ok" style="margin-bottom: 0.75rem;">Found ${paths.length} bugreport(s):</div>`;
        
        paths.forEach((path, index) => {
            const filename = path.split('/').pop();
            // Escape HTML attributes
            const escapedPath = path.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
            
            html += `
                <div class="bugreport-card">
                    <div class="bugreport-card__name">${filename}</div>
                    <div class="bugreport-card__meta mono">${path}</div>
                    <button 
                        type="button"
                        class="btn btn-primary download-bugreport-btn"
                        data-path="${escapedPath}">
                        Download
                    </button>
                </div>
            `;
        });
        
        output.innerHTML = html;
        
        // Attach event listeners to download buttons
        document.querySelectorAll('.download-bugreport-btn').forEach(btn => {
            btn.addEventListener('click', function() {
                let path = this.getAttribute('data-path');
                // Decode HTML entities
                path = path.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
                downloadExistingBugreport(path);
            });
        });
        
        showSuccess(`Found ${paths.length} bugreport(s) on device.`);
        
    } catch (error) {
        output.innerHTML = `<span class="diag-err">Error: ${error}</span>`;
        showError('Failed to list bugreports: ' + error);
    } finally {
        btn.disabled = false;
        btn.textContent = 'List Available Bugreports';
    }
}

async function downloadExistingBugreport(path) {
    const filename = path.split('/').pop();
    const debugPanel = document.getElementById('downloadDebug');
    const debugStatus = document.getElementById('downloadStatus');
    const debugFile = document.getElementById('debugFile');
    const debugSize = document.getElementById('debugSize');
    const debugTime = document.getElementById('debugTime');
    const debugSpeed = document.getElementById('debugSpeed');
    const debugLog = document.getElementById('debugLog');
    const progressBar = document.getElementById('downloadProgressBar');
    
    function addLog(msg) {
        const time = new Date().toLocaleTimeString();
        debugLog.innerHTML += `<div>[${time}] ${msg}</div>`;
        debugLog.scrollTop = debugLog.scrollHeight;
        console.log(`[Download] ${msg}`);
    }
    
    try {
        // Show debug panel
        debugPanel.style.display = 'block';
        debugStatus.textContent = 'Starting...';
        debugStatus.style.color = 'var(--aad-warn, #FF9800)';
        debugFile.textContent = filename;
        debugSize.textContent = '...';
        debugTime.textContent = '0s';
        debugSpeed.textContent = '...';
        debugLog.innerHTML = '';
        progressBar.style.width = '0%';
        progressBar.textContent = '';
        progressBar.style.background = '';
        
        addLog(`Starting download: ${filename}`);
        addLog(`Path: ${path}`);
        
        showWarning(`Downloading ${filename}... Please wait.`);
        
        const startTime = Date.now();
        debugStatus.textContent = 'Downloading...';
        debugStatus.style.color = 'var(--aad-accent, #34d399)';
        progressBar.style.width = '30%';
        progressBar.textContent = '30%';
        
        // Start timer
        const timerInterval = setInterval(() => {
            const elapsedMs = Date.now() - startTime;
            debugTime.textContent = formatDuration(elapsedMs);
        }, 100);
        
        addLog('Requesting file from device...');
        
        const data = await queueOperation(async () => {
            return await adb.download_bugreport(path);
        });
        
        clearInterval(timerInterval);
        
        const endTime = Date.now();
        const durationMs = endTime - startTime;
        const sizeStr = formatBytes(data.byteLength);
        const durationSeconds = durationMs / 1000;
        const speed = formatBytes(data.byteLength / (durationSeconds || 1)) + '/s';
        
        debugSize.textContent = sizeStr;
        debugTime.textContent = formatDuration(durationMs);
        debugSpeed.textContent = speed;
        progressBar.style.width = '100%';
        progressBar.textContent = '100%';
        
        addLog(`Download complete!`);
        addLog(`Size: ${sizeStr} (${data.byteLength} bytes)`);
        addLog(`Duration: ${formatDuration(durationMs)}`);
        addLog(`Average speed: ${speed}`);
        
        debugStatus.textContent = 'Saving...';
        debugStatus.style.color = 'var(--aad-success, #4CAF50)';
        
        const blob = new Blob([data], { 
            type: path.endsWith('.zip') ? 'application/zip' : 'text/plain' 
        });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        
        debugStatus.textContent = 'Complete';
        debugStatus.style.color = 'var(--aad-success, #4CAF50)';
        addLog('File saved successfully!');
        
        showSuccess(`Downloaded ${filename} (${sizeStr}) in ${formatDuration(durationMs)} at ${speed}`);
        
        // Hide debug panel after 5 seconds
        setTimeout(() => {
            debugPanel.style.display = 'none';
        }, 5000);
        
    } catch (error) {
        debugStatus.textContent = 'Failed';
        debugStatus.style.color = 'var(--aad-danger, #f44336)';
        progressBar.style.width = '100%';
        progressBar.style.background = 'var(--aad-danger, #f44336)';
        progressBar.textContent = 'ERROR';
        
        addLog(`ERROR: ${error}`);
        console.error(`[Download] Failed:`, error);
        showError(`Failed to download ${filename}: ${error}`);
    }
}

async function getLogcat() {
    const lines = parseInt(document.getElementById('logcatLines').value);
    const output = document.getElementById('logcatOutput');
    const downloadBtn = document.getElementById('downloadLogBtn');
    const btn = document.getElementById('logcatBtn');
    
    console.log(`[Logcat] getLogcat called with ${lines} lines`);
    const startTime = performance.now();
    
    try {
        btn.disabled = true;
        output.textContent = 'Fetching logcat...';
        
        const log = await queueOperation(async () => {
            console.log(`[Logcat] Calling adb.logcat(${lines})`);
            const result = await adb.logcat(lines);
            console.log(`[Logcat] Received ${result.length} characters of logcat`);
            return result;
        });
        
        const duration = performance.now() - startTime;
        console.log(`[Logcat] Logcat retrieved in ${formatDuration(duration)}`);
        currentLog = log;
        output.textContent = log;
        downloadBtn.disabled = false;
    } catch (error) {
        const duration = performance.now() - startTime;
        console.error(`[Logcat] Failed after ${formatDuration(duration)}:`, error);
        output.textContent = 'Error: ' + error;
        showError('Failed to get logcat: ' + error);
    } finally {
        btn.disabled = false;
    }
}

async function clearLogcat() {
    const btn = document.getElementById('logcatClearBtn');
    try {
        btn.disabled = true;
        await queueOperation(async () => {
            return await adb.logcat_clear();
        });
        document.getElementById('logcatOutput').textContent = 'Logcat cleared.';
        showSuccess('Logcat buffer cleared');
    } catch (error) {
        showError('Failed to clear logcat: ' + error);
    } finally {
        btn.disabled = false;
    }
}

function downloadLog() {
    if (!currentLog) return;
    
    const blob = new Blob([currentLog], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'logcat-' + new Date().getTime() + '.txt';
    a.click();
    URL.revokeObjectURL(url);
}

async function listDirectory() {
    const path = document.getElementById('filePath').value;
    const fileList = document.getElementById('fileList');
    
    try {
        fileList.innerHTML = 'Loading...';
        fileList.style.display = 'block';
        
        const entries = await queueOperation(async () => {
            return await adb.list_directory(path);
        });
        
        fileList.innerHTML = '';
        entries.forEach(entry => {
            const div = document.createElement('div');
            div.className = 'file-item';
            
            const icon = entry.is_directory ? '📁' : '📄';
            const size = entry.is_directory ? '' : ` (${formatBytes(entry.size)})`;
            
            div.innerHTML = `
                <span><span class="file-icon">${icon}</span>${entry.name}${size}</span>
                <button onclick="pullFile('${path}/${entry.name}')">Download</button>
            `;
            
            fileList.appendChild(div);
        });
    } catch (error) {
        fileList.textContent = 'Error: ' + error;
        showError('Failed to list directory: ' + error);
    }
}

async function statFile() {
    const path = document.getElementById('filePath').value;
    const output = document.getElementById('fileStatOutput');
    
    try {
        output.style.display = 'block';
        output.textContent = 'Getting file info...';
        
        const stat = await queueOperation(async () => {
            return await adb.stat_file(path);
        });
        
        output.textContent = `File: ${path}
Type: ${stat.is_directory ? 'Directory' : 'File'}
Size: ${formatBytes(stat.size)}
Mode: ${stat.mode.toString(8)}
Modified: ${new Date(stat.mtime * 1000).toLocaleString()}`;
    } catch (error) {
        output.textContent = 'Error: ' + error;
        showError('Failed to stat file: ' + error);
    }
}

window.pullFile = async function(path) {
    try {
        showWarning('Downloading file: ' + path);
        const data = await queueOperation(async () => {
            return await adb.pull_file(path);
        });
        
        const blob = new Blob([data]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path.split('/').pop();
        a.click();
        URL.revokeObjectURL(url);
        
        showSuccess('File downloaded successfully');
    } catch (error) {
        showError('Failed to pull file: ' + error);
    }
};

async function captureScreenshot() {
    const output = document.getElementById('advancedOutput');
    try {
        output.textContent = 'Capturing screenshot...';
        const result = await queueOperation(async () => {
            return await adb.shell('screencap -p /sdcard/screenshot.png && echo "Screenshot saved to /sdcard/screenshot.png"');
        });
        output.textContent = result;
        showSuccess('Screenshot captured! Pull /sdcard/screenshot.png to download');
    } catch (error) {
        output.textContent = 'Error: ' + error;
    }
}

async function dumpState() {
    const output = document.getElementById('advancedOutput');
    try {
        output.textContent = 'Dumping system state...';
        const result = await queueOperation(async () => {
            return await adb.shell('dumpsys -l');
        });
        output.textContent = result;
    } catch (error) {
        output.textContent = 'Error: ' + error;
    }
}

async function listPackages() {
    const output = document.getElementById('advancedOutput');
    try {
        output.textContent = 'Listing packages...';
        const result = await queueOperation(async () => {
            return await adb.shell('pm list packages');
        });
        output.textContent = result;
    } catch (error) {
        output.textContent = 'Error: ' + error;
    }
}

function updateStatus(state, text) {
    const statusEl = document.getElementById('status');
    statusEl.className = 'status ' + state;
    statusEl.textContent = 'Status: ' + text;
}

function enableButtons() {
    document.querySelectorAll('#adb-workspace button:not(#connectBtn)').forEach(btn => {
        if (btn.id !== 'downloadReportBtn' && btn.id !== 'viewReportBtn' && btn.id !== 'downloadLogBtn') {
            btn.disabled = false;
        }
    });
    document.getElementById('connectBtn').disabled = true;
    
    // Explicitly enable disconnect button
    const disconnectBtn = document.getElementById('disconnectBtn');
    if (disconnectBtn) {
        disconnectBtn.disabled = false;
    }
    
    // Enable shell
    document.getElementById('shellInput').disabled = false;
    document.getElementById('shellExecuteBtn').disabled = false;
    document.getElementById('shellInput').focus();
}

function disableButtons() {
    document.querySelectorAll('#adb-workspace button:not(#connectBtn)').forEach(btn => {
        btn.disabled = true;
    });
    document.getElementById('connectBtn').disabled = false;
    
    // Disable shell
    document.getElementById('shellInput').disabled = true;
    document.getElementById('shellExecuteBtn').disabled = true;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function showSuccess(message) {
    showMessage(message, 'success');
}

function showWarning(message) {
    showMessage(message, 'warning');
}

function showError(message) {
    showMessage(message, 'error');
}

function showMessage(message, type) {
    const div = document.createElement('div');
    div.className = 'flash-msg ' + type;
    div.textContent = message;
    const status = document.getElementById('status');
    const ws = document.getElementById('adb-workspace');
    if (status && status.parentNode) {
        status.parentNode.insertBefore(div, status.nextSibling);
    } else if (ws && ws.parentNode) {
        ws.parentNode.insertBefore(div, ws);
    }
    setTimeout(() => div.remove(), 5000);
}

let booted = false;
export async function bootAndroidAdvanced() {
  if (booted) return;
  booted = true;
    await init();

    if (!has_keypair()) {
        generate_keypair();
    }

    adb = new Adb();

    setupEventListeners();
    document.getElementById('connectBtn').disabled = false;
  // Expose reset for HTML onclick="resetQueue()"
  window.resetQueue = resetQueue;
}
export function resetAndroidAdvancedBoot() { booted = false; }

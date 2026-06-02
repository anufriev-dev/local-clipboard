const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const statusDiv = document.getElementById('status');
const fileInput = document.getElementById('fileInput');
const fileAttachmentsDiv = document.getElementById('fileAttachments');
const intervalSelect = document.getElementById('intervalSelect');
const countdownDisplay = document.getElementById('countdownDisplay');
const pauseResumeBtn = document.getElementById('pauseResumeBtn');
const clearNowBtn = document.getElementById('clearNowBtn');

let ws = null;
const ownMessageIds = new Set();
let selectedFiles = [];
let fileChipIdCounter = 0;
let nextClearTime = null;
let countdownInterval = null;
let connectedCount = 0;

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    statusDiv.textContent = 'Подключено ✅';
    statusDiv.className = 'status connected';
    messageInput.disabled = false;
    fileInput.disabled = false;
    updateSendButton();
    messageInput.focus();
  };

  ws.onclose = () => {
    statusDiv.textContent = '⚡ Обрыв связи. Переподключение...';
    statusDiv.className = 'status disconnected';
    messageInput.disabled = true;
    sendButton.disabled = true;
    fileInput.disabled = true;
    setTimeout(connect, 2000);
  };

  ws.onerror = error => {
    console.error('WebSocket error:', error);
    statusDiv.textContent = 'Ошибка подключения';
    statusDiv.className = 'status disconnected';
  };

  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.type === 'clear') {
      clearAllMessages();
      return;
    }
    if (data.type === 'config') {
      applyConfig(data.config);
      return;
    }
    if (data.type === 'clients') {
      connectedCount = data.count;

      // Функция склонения
      const getDeviceWord = (count) => {
        const mod10 = count % 10;
        const mod100 = count % 100;

        if (mod100 >= 11 && mod100 <= 14) return 'устройств';
        if (mod10 === 1) return 'устройство';
        if (mod10 >= 2 && mod10 <= 4) return 'устройства';
        return 'устройств';
      };

      statusDiv.textContent = `Подключено ✅ · ${connectedCount} ${getDeviceWord(connectedCount)}`;
      return;
    }
    if (data.id && ownMessageIds.has(data.id)) {
      ownMessageIds.delete(data.id);
      return;
    }
    const fileId = data.file?.id || data.id;
    addMessage(data.text || '', data.file, false, fileId || data.id, data.senderIp || '');
  };
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function addMessage(text, file, isOwn, messageId, senderIp) {
  const emptyState = messagesDiv.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${isOwn ? 'own' : 'other'}`;

  const headerDiv = document.createElement('div');
  headerDiv.className = 'message-header';
  headerDiv.textContent = isOwn ? 'Вы' : senderIp || 'Аноним';
  messageDiv.appendChild(headerDiv);

  if (text) {
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.dir = 'auto';
    textDiv.textContent = text;
    messageDiv.appendChild(textDiv);
  }

  if (file) {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'message-file';
    fileDiv.innerHTML = `
      <span class="file-icon">📎</span>
      <span class="file-info">
        <span class="file-name-display">${escapeHTML(file.name)}</span>
        <span class="file-size">${formatFileSize(file.size)}</span>
      </span>
    `;
    messageDiv.appendChild(fileDiv);
  }

  const hasActions = (text && (!isMobile() || window.isSecureContext)) || file;
  if (hasActions) {
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'message-actions';

    if (text && (!isMobile() || window.isSecureContext)) {
      const copyBtn = document.createElement('button');
      copyBtn.className = 'action-btn copy-btn';
      copyBtn.textContent = 'Копировать';
      copyBtn.onclick = () => copyMessage(text, copyBtn);
      actionsDiv.appendChild(copyBtn);
    }

    if (file) {
      const fileId = file.id || messageId;
      const downloadBtn = document.createElement('button');
      downloadBtn.className = 'action-btn download-btn';
      downloadBtn.textContent = 'Скачать';
      downloadBtn.onclick = () => downloadFile(fileId, file.name);
      actionsDiv.appendChild(downloadBtn);
    }

    messageDiv.appendChild(actionsDiv);
  }

  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function clearAllMessages() {
  messagesDiv.innerHTML = '<div class="empty-state">🌱 Поле пустует. Посадите первое сообщение!</div>';
}

function applyConfig(config) {
  if (!config) return;
  const newVal = String(config.intervalMin || 0);
  if (intervalSelect.value !== newVal) intervalSelect.value = newVal;
  const hasInterval = (config.intervalMin || 0) > 0;
  pauseResumeBtn.style.display = hasInterval ? 'inline-flex' : 'none';
  pauseResumeBtn.textContent = config.paused ? '▶' : '⏸';
  pauseResumeBtn.title = config.paused ? 'Resume timer' : 'Pause timer';
  if (hasInterval && !config.paused && config.nextClearTime) {
    nextClearTime = new Date(config.nextClearTime);
    countdownDisplay.style.display = 'inline';
    startCountdown();
  } else {
    nextClearTime = null;
    countdownDisplay.style.display = 'none';
    stopCountdown();
  }
}

function startCountdown() {
  stopCountdown();
  updateCountdownDisplay();
  countdownInterval = setInterval(updateCountdownDisplay, 1000);
}

function stopCountdown() {
  if (countdownInterval !== null) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

function updateCountdownDisplay() {
  if (!nextClearTime) {
    countdownDisplay.style.display = 'none';
    stopCountdown();
    return;
  }
  const diffMs = nextClearTime - Date.now();
  if (diffMs <= 0) {
    countdownDisplay.style.display = 'none';
    stopCountdown();
    return;
  }
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  countdownDisplay.textContent = h > 0 ? `Осталось: ${h}h ${mm}:${ss}` : `Осталось: ${mm}:${ss}`;
}

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function copyMessage(text, button) {
  function onSuccess() {
    button.classList.add('copied');
    button.textContent = 'Скопировано!';
    setTimeout(() => {
      button.classList.remove('copied');
      button.textContent = 'Копировать';
    }, 2000);
  }

  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard
      .writeText(text)
      .then(onSuccess)
      .catch(() => {
        fallbackCopy(text, onSuccess);
      });
  } else {
    fallbackCopy(text, onSuccess);
  }
}

function fallbackCopy(text, onSuccess) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    onSuccess();
  } catch (err) {
    console.error('Ошибка копирования:', err);
  }
  document.body.removeChild(textarea);
}

function downloadFile(fileId, fileName) {
  const url = `/file/${fileId}`;
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/upload', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Upload failed');
  }

  return await response.json();
}

function sendOwnMessage(text, fileData) {
  const messageId = fileData?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const message = {
    id: messageId,
    text: text,
    file: fileData || null
  };
  ownMessageIds.add(messageId);
  ws.send(JSON.stringify(message));
  addMessage(text, fileData || null, true, messageId, '');
}

async function sendMessage() {
  const text = messageInput.value.trim();
  const hasFiles = selectedFiles.length > 0;

  if ((!text && !hasFiles) || !ws || ws.readyState !== WebSocket.OPEN) {
    return;
  }

  sendButton.disabled = true;
  sendButton.textContent = '⌛';

  try {
    if (hasFiles) {
      const filesToSend = selectedFiles.slice();
      const textToSend = text;
      let textSent = false;

      for (let i = 0; i < filesToSend.length; i++) {
        const item = filesToSend[i];
        let uploadResult;
        try {
          uploadResult = await uploadFile(item.file);
        } catch (error) {
          alert(`Failed to upload ${item.file.name}.`);
          continue;
        }
        const fileData = {
          id: uploadResult.id,
          name: uploadResult.name,
          size: uploadResult.size,
          type: uploadResult.type
        };
        // Attach the text to the first file message so it stays associated
        const attachText = !textSent ? textToSend : '';
        sendOwnMessage(attachText, fileData);
        textSent = true;
      }

      // If we had text but every upload failed, still send the text alone
      if (!textSent && textToSend) {
        sendOwnMessage(textToSend, null);
      }
    } else {
      sendOwnMessage(text, null);
    }

    messageInput.value = '';
    messageInput.style.height = 'auto';
    clearFiles(false);
  } finally {
    sendButton.textContent = '➤';
    messageInput.focus();
    updateSendButton();
  }
}

function updateSendButton() {
  const hasText = messageInput.value.trim().length > 0;
  const hasFiles = selectedFiles.length > 0;
  sendButton.disabled = !hasText && !hasFiles;
}

function renderAttachments() {
  fileAttachmentsDiv.innerHTML = '';
  if (selectedFiles.length === 0) {
    fileAttachmentsDiv.style.display = 'none';
    return;
  }
  fileAttachmentsDiv.style.display = 'flex';
  for (const item of selectedFiles) {
    const chip = document.createElement('div');
    chip.className = 'file-chip';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'file-chip-icon';
    iconSpan.textContent = '📎';
    chip.appendChild(iconSpan);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-chip-name';
    nameSpan.textContent = item.file.name;
    nameSpan.title = item.file.name;
    chip.appendChild(nameSpan);

    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-chip-size';
    sizeSpan.textContent = formatFileSize(item.file.size);
    chip.appendChild(sizeSpan);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-chip-remove';
    removeBtn.title = 'Remove file';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => removeFileChip(item.id, chip));
    chip.appendChild(removeBtn);

    fileAttachmentsDiv.appendChild(chip);
  }
}

function removeFileChip(id, chipEl) {
  chipEl.classList.add('removing');
  setTimeout(() => {
    selectedFiles = selectedFiles.filter(f => f.id !== id);
    renderAttachments();
    if (selectedFiles.length === 0) fileInput.value = '';
    updateSendButton();
  }, 200);
}

function clearFiles(animated = true) {
  if (animated && selectedFiles.length > 0) {
    const chips = fileAttachmentsDiv.querySelectorAll('.file-chip');
    chips.forEach(c => c.classList.add('removing'));
    setTimeout(() => {
      selectedFiles = [];
      renderAttachments();
      fileInput.value = '';
      updateSendButton();
    }, 200);
  } else {
    selectedFiles = [];
    renderAttachments();
    fileInput.value = '';
    updateSendButton();
  }
}

fileInput.addEventListener('change', e => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    selectedFiles.push({ id: ++fileChipIdCounter, file });
  }
  // Reset input so selecting the same file again still fires change
  fileInput.value = '';
  renderAttachments();
  updateSendButton();
});

sendButton.addEventListener('click', sendMessage);

messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

messageInput.addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = this.scrollHeight + 'px';
  updateSendButton();
});


// QR code toggle functionality
const qrToggle = document.getElementById('qrToggle');
const qrContainer = document.getElementById('qrContainer');
const qrSection = document.getElementById('qrSection');

// Hide QR section on mobile devices
if (isMobile()) {
  qrSection.style.display = 'none';
} else {
  qrToggle.addEventListener('click', () => {
    const isCollapsed = qrContainer.classList.contains('collapsed');
    if (isCollapsed) {
      qrContainer.classList.remove('collapsed');
      qrToggle.textContent = 'Скрыть QR-код';
    } else {
      qrContainer.classList.add('collapsed');
      qrToggle.textContent = 'Показать QR-код';
    }
  });
}

intervalSelect.addEventListener('change', () => {
  fetch('/set-interval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interval: parseInt(intervalSelect.value, 10) })
  }).catch(err => console.error('Failed to set interval:', err));
});

pauseResumeBtn.addEventListener('click', () => {
  fetch('/toggle-pause', { method: 'POST' }).catch(err =>
    console.error('Failed to toggle pause:', err)
  );
});

clearNowBtn.addEventListener('click', () => {
  fetch('/clear', { method: 'POST' }).catch(err => console.error('Failed to clear:', err));
});

connect();

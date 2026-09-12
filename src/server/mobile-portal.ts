/**
 * Standalone Mobile Upload Portal HTML Generator
 * Generates high-performance, responsive HTML for customer phone uploads.
 * Requires zero cookies, zero external libraries, and runs on any smartphone browser.
 */

export function renderErrorHtml(title: string, message: string, statusCode: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${statusCode} - ${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: #f8fafc; color: #0f172a; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; max-width: 440px; width: 100%; padding: 32px 24px; text-align: center; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .icon-box { width: 56px; height: 56px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px; }
    .icon-403 { background: #fee2e2; color: #dc2626; font-size: 26px; }
    .icon-410 { background: #fef3c7; color: #d97706; font-size: 26px; }
    h1 { font-size: 20px; font-weight: 700; color: #0f172a; margin-bottom: 10px; }
    p { font-size: 14px; color: #475569; line-height: 1.5; margin-bottom: 24px; }
    .badge { display: inline-block; font-size: 11px; font-weight: 600; text-transform: uppercase; padding: 4px 10px; border-radius: 9999px; background: #f1f5f9; color: #64748b; }
    .footer { margin-top: 24px; font-size: 12px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon-box ${statusCode === 410 ? 'icon-410' : 'icon-403'}">
      ${statusCode === 410 ? '&#9203;' : '&#9888;'}
    </div>
    <span class="badge">HTTP ${statusCode} ${statusCode === 410 ? 'Expired' : 'Forbidden'}</span>
    <h1 style="margin-top: 12px;">${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    <div class="footer">SmartForm AI &bull; Cyber Café Document Assistant</div>
  </div>
</body>
</html>`;
}

export function renderMobileUploadHtml(
  sessionId: string,
  token: string,
  docName: string,
  expiresAt: number
): string {
  const expiryDate = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Upload ${escapeHtml(docName)} - SmartForm AI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: #f1f5f9; color: #0f172a; min-height: 100vh; padding: 16px; display: flex; flex-direction: column; justify-content: space-between; }
    .container { max-width: 440px; margin: 0 auto; width: 100%; }
    .header { text-align: center; margin-top: 12px; margin-bottom: 20px; }
    .logo-badge { display: inline-flex; align-items: center; gap: 6px; background: #e0f2fe; color: #0369a1; padding: 4px 12px; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-bottom: 8px; }
    .header h1 { font-size: 22px; font-weight: 800; color: #0f172a; }
    .header p { font-size: 13px; color: #64748b; margin-top: 4px; }
    
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 20px; padding: 24px 20px; box-shadow: 0 4px 12px -2px rgba(0,0,0,0.05); margin-bottom: 16px; }
    .req-banner { text-align: center; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 16px; }
    .req-label { font-size: 11px; font-weight: 700; text-transform: uppercase; color: #0284c7; letter-spacing: 0.5px; }
    .doc-title { font-size: 22px; font-weight: 800; color: #0f172a; margin-top: 4px; }
    .doc-hint { font-size: 13px; color: #475569; margin-top: 6px; line-height: 1.4; }

    .drop-zone { border: 2px dashed #93c5fd; background: #f8fafc; border-radius: 14px; padding: 28px 16px; text-align: center; cursor: pointer; transition: all 0.2s ease; margin-bottom: 16px; }
    .drop-zone:active, .drop-zone.dragover { background: #eff6ff; border-color: #2563eb; }
    .drop-icon { font-size: 36px; margin-bottom: 8px; color: #3b82f6; }
    .drop-prompt { font-size: 15px; font-weight: 600; color: #1e293b; }
    .drop-sub { font-size: 12px; color: #64748b; margin-top: 4px; }

    .file-preview { display: none; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; padding: 12px 14px; margin-bottom: 16px; align-items: center; justify-content: space-between; }
    .file-info { font-size: 13px; font-weight: 600; color: #1e40af; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 250px; }
    .file-size { font-size: 11px; color: #60a5fa; margin-top: 2px; }
    .btn-change { background: none; border: none; font-size: 12px; color: #2563eb; font-weight: 600; cursor: pointer; text-decoration: underline; }

    .upload-btn { width: 100%; background: #0284c7; color: #ffffff; border: none; padding: 14px; font-size: 16px; font-weight: 700; border-radius: 12px; cursor: pointer; box-shadow: 0 2px 4px rgba(2,132,199,0.2); transition: all 0.2s ease; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .upload-btn:hover { background: #0369a1; }
    .upload-btn:disabled { background: #94a3b8; cursor: not-allowed; box-shadow: none; }

    .alert { display: none; border-radius: 14px; padding: 16px; margin-top: 16px; font-size: 13px; line-height: 1.5; }
    .alert-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
    .alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; color: #166534; }
    .alert-title { font-weight: 700; font-size: 14px; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }

    .meta-box { font-size: 11px; color: #64748b; text-align: center; margin-top: 8px; }
    .spinner { display: none; width: 20px; height: 20px; border: 3px solid rgba(255,255,255,0.3); border-radius: 50%; border-top-color: #fff; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    .footer { text-align: center; font-size: 12px; color: #94a3b8; padding: 16px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-badge">&#128274; Secure Document Transfer</div>
      <h1>Upload Document</h1>
      <p>Cyber Café Operator Assistant Portal</p>
    </div>

    <div class="card">
      <div class="req-banner">
        <div class="req-label">Target Document Requirement</div>
        <div class="doc-title">${escapeHtml(docName)}</div>
        <p class="doc-hint">Please photograph or select your original <strong>${escapeHtml(docName)}</strong>. Ensure text is clearly visible and not blurry.</p>
      </div>

      <form id="uploadForm">
        <input type="file" id="fileInput" name="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" style="display:none;" />
        
        <div id="dropZone" class="drop-zone" onclick="document.getElementById('fileInput').click()">
          <div class="drop-icon">&#128247;</div>
          <div class="drop-prompt">Take Photo or Choose File</div>
          <div class="drop-sub">Camera / PDF / JPG / PNG (Max 10MB)</div>
        </div>

        <div id="filePreview" class="file-preview">
          <div>
            <div id="fileName" class="file-info">document.pdf</div>
            <div id="fileSize" class="file-size">0 KB</div>
          </div>
          <button type="button" class="btn-change" onclick="document.getElementById('fileInput').click()">Change</button>
        </div>

        <button type="submit" id="uploadBtn" class="upload-btn" disabled>
          <span class="spinner" id="btnSpinner"></span>
          <span id="btnText">Upload & Verify with AI</span>
        </button>
      </form>

      <!-- Rejection Alert -->
      <div id="errorAlert" class="alert alert-error">
        <div class="alert-title">&#9888; Wrong Document Uploaded</div>
        <div id="errorMessage"></div>
      </div>

      <!-- Success Alert -->
      <div id="successAlert" class="alert alert-success">
        <div class="alert-title">&#10004; Document Verified!</div>
        <div id="successMessage"></div>
      </div>

      <div class="meta-box">
        Single-use secure token &bull; Valid until ${expiryDate}
      </div>
    </div>
  </div>

  <div class="footer">
    SmartForm AI &bull; Encrypted &bull; No documents stored permanently
  </div>

  <script>
    const form = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    const filePreview = document.getElementById('filePreview');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const uploadBtn = document.getElementById('uploadBtn');
    const btnSpinner = document.getElementById('btnSpinner');
    const btnText = document.getElementById('btnText');
    const errorAlert = document.getElementById('errorAlert');
    const errorMessage = document.getElementById('errorMessage');
    const successAlert = document.getElementById('successAlert');
    const successMessage = document.getElementById('successMessage');

    const sessionId = ${JSON.stringify(sessionId)};
    const token = ${JSON.stringify(token)};
    const expectedDoc = ${JSON.stringify(docName)};

    fileInput.addEventListener('change', (e) => {
      if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        fileName.innerText = file.name;
        fileSize.innerText = (file.size / 1024).toFixed(1) + ' KB';
        filePreview.style.display = 'flex';
        dropZone.style.display = 'none';
        uploadBtn.disabled = false;
        errorAlert.style.display = 'none';
        successAlert.style.display = 'none';
      }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!fileInput.files || !fileInput.files[0]) return;

      uploadBtn.disabled = true;
      btnSpinner.style.display = 'inline-block';
      btnText.innerText = 'Analyzing with Gemini AI...';
      errorAlert.style.display = 'none';
      successAlert.style.display = 'none';

      const formData = new FormData();
      formData.append('session', sessionId);
      formData.append('token', token);
      formData.append('file', fileInput.files[0]);

      try {
        const res = await fetch('/api/documents/upload', {
          method: 'POST',
          body: formData
        });

        const data = await res.json();

        if (res.ok && data.success) {
          form.style.display = 'none';
          successAlert.style.display = 'block';
          successMessage.innerHTML = '<strong>' + escapeHtml(data.detectedType || expectedDoc) + '</strong> verified successfully (' + Math.round((data.confidence || 0.95) * 100) + '% match).<br><br>The candidate data has been securely transferred to the operator dashboard. You may now close this browser tab.';
        } else {
          errorAlert.style.display = 'block';
          const reason = data.reason || data.message || data.error || 'The uploaded file does not match the required document.';
          errorMessage.innerHTML = '<strong>Mismatch Detected:</strong> ' + escapeHtml(reason) + '<br><br>Please select your actual <strong>' + escapeHtml(expectedDoc) + '</strong> and try again.';
          uploadBtn.disabled = false;
          btnText.innerText = 'Try Uploading Again';
        }
      } catch (err) {
        errorAlert.style.display = 'block';
        errorMessage.innerText = 'Network error during upload: ' + (err.message || 'Please check your connection and retry.');
        uploadBtn.disabled = false;
        btnText.innerText = 'Retry Upload';
      } finally {
        btnSpinner.style.display = 'none';
      }
    });

    function escapeHtml(str) {
      return (str || '').replace(/[&<>"']/g, function(m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
      });
    }
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return (str || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[m]);
}

/**
 * Standalone Mobile Upload Portal HTML Generator
 * Generates high-performance, mobile-first HTML for customer smartphone uploads.
 * Single QR Code -> One Page -> Multi-Document Upload & Independent Verification.
 * Pure native HTML/CSS/JS: zero external dependencies, ultra-fast loading on any smartphone.
 */

import { ApplicationSession, DocumentRequirement } from '../types.js';

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
  sessionOrId: ApplicationSession | string,
  token: string,
  docNameOrExpiresAt?: string | number,
  optionalExpiresAt?: number
): string {
  let session: ApplicationSession | null = null;
  let docRequirements: DocumentRequirement[] = [];
  let sessionId = '';
  let expiresAt = Date.now() + 3600 * 1000;

  if (typeof sessionOrId === 'object' && sessionOrId !== null) {
    session = sessionOrId;
    sessionId = session.id;
    docRequirements = session.documentRequirements || [];
    expiresAt = typeof docNameOrExpiresAt === 'number' ? docNameOrExpiresAt : Date.now() + 3600 * 1000;
  } else {
    sessionId = typeof sessionOrId === 'string' ? sessionOrId : '';
    expiresAt = typeof optionalExpiresAt === 'number' ? optionalExpiresAt : Date.now() + 3600 * 1000;
    const singleDocName = typeof docNameOrExpiresAt === 'string' ? docNameOrExpiresAt : 'ALL';
    
    if (singleDocName && singleDocName !== 'Required Document' && singleDocName !== 'ALL' && singleDocName !== 'ALL_DOCUMENTS') {
      docRequirements = [
        {
          id: 'req_1',
          applicationId: sessionId,
          documentType: singleDocName,
          uploadToken: token,
          qrDataUrl: '',
          uploadUrl: '',
          status: 'pending',
        },
      ];
    } else {
      const standardList = [
        'Aadhaar Card',
        'High School Marksheet',
        'Intermediate Marksheet',
        'Graduation Marksheet',
        'Photograph',
        'Signature',
        'Caste Certificate',
        'Income Certificate',
      ];
      docRequirements = standardList.map((name, idx) => ({
        id: `req_${idx + 1}`,
        applicationId: sessionId,
        documentType: name,
        uploadToken: token,
        qrDataUrl: '',
        uploadUrl: '',
        status: 'pending',
      }));
    }
  }

  // If docRequirements is somehow empty, populate standard required documents
  if (!docRequirements || docRequirements.length === 0) {
    const standardList = [
      'Aadhaar Card',
      'High School Marksheet',
      'Intermediate Marksheet',
      'Graduation Marksheet',
      'Photograph',
      'Signature',
      'Caste Certificate',
      'Income Certificate',
    ];
    docRequirements = standardList.map((name, idx) => ({
      id: `req_${idx + 1}`,
      applicationId: sessionId,
      documentType: name,
      uploadToken: token,
      qrDataUrl: '',
      uploadUrl: '',
      status: 'pending',
    }));
  }

  const expiryDate = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formTitle = session?.pageTitle || session?.url || 'Government Application';
  const totalCount = docRequirements.length;
  const verifiedCount = docRequirements.filter((d) => d.status === 'verified').length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Upload Documents - SmartForm AI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    body { background: #f8fafc; color: #0f172a; min-height: 100vh; padding: 12px 16px 32px 16px; display: flex; flex-direction: column; justify-content: space-between; }
    .container { max-width: 500px; margin: 0 auto; width: 100%; }
    
    /* Header */
    .header { text-align: center; margin-top: 8px; margin-bottom: 16px; }
    .logo-badge { display: inline-flex; align-items: center; gap: 6px; background: #e0f2fe; color: #0369a1; padding: 5px 14px; border-radius: 9999px; font-size: 12px; font-weight: 700; margin-bottom: 8px; }
    .header h1 { font-size: 24px; font-weight: 800; color: #0f172a; letter-spacing: -0.5px; }
    .header p { font-size: 13px; color: #64748b; margin-top: 4px; line-height: 1.4; }

    /* Session Summary Card */
    .session-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px 20px; box-shadow: 0 2px 8px -2px rgba(0,0,0,0.05); margin-bottom: 16px; }
    .session-meta { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .session-tag { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
    .session-status { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; background: #f1f5f9; color: #475569; }
    .session-status.complete { background: #dcfce7; color: #15803d; }
    
    .progress-wrap { margin-top: 6px; }
    .progress-text { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; color: #1e293b; margin-bottom: 6px; }
    .progress-bar-bg { height: 8px; background: #f1f5f9; border-radius: 9999px; overflow: hidden; }
    .progress-bar-fill { height: 100%; background: #0284c7; border-radius: 9999px; transition: width 0.3s ease; }
    .progress-bar-fill.all-verified { background: #16a34a; }

    /* All Documents Verified Banner */
    .all-done-banner { display: none; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 16px; padding: 16px; margin-bottom: 16px; text-align: center; }
    .all-done-banner.show { display: block; }
    .all-done-title { font-size: 16px; font-weight: 800; color: #166534; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 4px; }
    .all-done-sub { font-size: 12px; color: #15803d; line-height: 1.4; }

    /* Section Title */
    .section-title { font-size: 14px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; padding-left: 2px; }

    /* Document Cards */
    .docs-list { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
    .doc-card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; box-shadow: 0 2px 4px rgba(0,0,0,0.03); transition: all 0.2s ease; position: relative; }
    .doc-card.verified { border-color: #86efac; background: #fcfdfc; }
    .doc-card.rejected { border-color: #fca5a5; background: #fffcfc; }
    .doc-card.uploading { border-color: #93c5fd; background: #f8fbff; }

    .doc-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .doc-name { font-size: 16px; font-weight: 700; color: #0f172a; line-height: 1.3; }
    .doc-pill { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; white-space: nowrap; }
    .pill-pending { background: #f1f5f9; color: #64748b; }
    .pill-uploading { background: #e0f2fe; color: #0284c7; }
    .pill-processing { background: #fef3c7; color: #b45309; }
    .pill-verified { background: #dcfce7; color: #15803d; }
    .pill-rejected { background: #fee2e2; color: #b91c1c; }

    .doc-details { font-size: 12px; color: #64748b; margin-bottom: 12px; line-height: 1.4; }
    .doc-details.error-text { color: #b91c1c; font-weight: 500; }
    .doc-details.success-text { color: #15803d; font-weight: 500; }

    /* Inline Progress Indicator */
    .inline-progress { display: none; height: 4px; background: #e2e8f0; border-radius: 9999px; overflow: hidden; margin-bottom: 12px; }
    .inline-progress.active { display: block; }
    .inline-progress-fill { height: 100%; width: 0%; background: #0284c7; transition: width 0.15s linear; }

    /* Action Buttons */
    .action-row { display: flex; align-items: center; gap: 8px; }
    .btn-upload { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: #0284c7; color: #ffffff; border: none; padding: 11px 16px; font-size: 14px; font-weight: 700; border-radius: 10px; cursor: pointer; transition: all 0.2s; box-shadow: 0 1px 3px rgba(2,132,199,0.2); }
    .btn-upload:hover { background: #0369a1; }
    .btn-upload:disabled { background: #94a3b8; cursor: not-allowed; box-shadow: none; }
    
    .btn-replace { background: #ffffff; color: #475569; border: 1px solid #cbd5e1; padding: 9px 14px; font-size: 13px; font-weight: 600; border-radius: 10px; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }
    .btn-replace:hover { background: #f8fafc; border-color: #94a3b8; }

    /* Rejection Details Box */
    .reject-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 10px 12px; font-size: 12px; color: #991b1b; margin-bottom: 12px; line-height: 1.4; }
    .reject-box strong { font-weight: 700; }

    /* Footer & Privacy */
    .privacy-badge { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 11px; color: #64748b; text-align: center; margin-top: 16px; }
    .footer { text-align: center; font-size: 12px; color: #94a3b8; margin-top: 20px; line-height: 1.4; }
    
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.4); border-radius: 50%; border-top-color: #fff; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <div class="logo-badge">&#128274; Secure Single QR Upload</div>
      <h1>Upload Your Documents</h1>
      <p>Please upload all required certificates and documents below for your application. No need to scan again.</p>
    </div>

    <!-- Session Progress Card -->
    <div class="session-card">
      <div class="session-meta">
        <span class="session-tag">Application: ${escapeHtml(sessionId.slice(0, 8))}</span>
        <span id="sessionStatusBadge" class="session-status ${verifiedCount === totalCount && totalCount > 0 ? 'complete' : ''}">
          ${verifiedCount === totalCount && totalCount > 0 ? 'All Verified' : 'In Progress'}
        </span>
      </div>

      <div class="progress-wrap">
        <div class="progress-text">
          <span>Required Documents</span>
          <span id="progressRatio">${verifiedCount} of ${totalCount} verified</span>
        </div>
        <div class="progress-bar-bg">
          <div
            id="progressBarFill"
            class="progress-bar-fill ${verifiedCount === totalCount && totalCount > 0 ? 'all-verified' : ''}"
            style="width: ${totalCount > 0 ? Math.round((verifiedCount / totalCount) * 100) : 0}%;"
          ></div>
        </div>
      </div>
    </div>

    <!-- All Documents Verified Banner -->
    <div id="allDoneBanner" class="all-done-banner ${verifiedCount === totalCount && totalCount > 0 ? 'show' : ''}">
      <div class="all-done-title">&#10004; All Documents Verified!</div>
      <div class="all-done-sub">
        Every required document has been verified. The cyber café operator has received the extracted data and is autofilling your government form.
      </div>
    </div>

    <!-- Required Documents List -->
    <div class="section-title">Required Documents (${totalCount})</div>
    <div class="docs-list" id="docsList">
      ${docRequirements
        .map((doc) => {
          const isVer = doc.status === 'verified';
          const isRej = doc.status === 'rejected';
          const cardClass = isVer ? 'verified' : isRej ? 'rejected' : '';
          const pillClass = isVer ? 'pill-verified' : isRej ? 'pill-rejected' : 'pill-pending';
          const pillText = isVer ? '&#10004; Verified' : isRej ? '&#9888; Wrong Document' : 'Waiting for upload';

          return `
        <div class="doc-card ${cardClass}" id="card-${doc.id}" data-doc-id="${doc.id}" data-doc-type="${escapeHtml(doc.documentType)}">
          <div class="doc-header">
            <div class="doc-name">${escapeHtml(doc.documentType)}</div>
            <span class="doc-pill ${pillClass}" id="pill-${doc.id}">${pillText}</span>
          </div>

          <div class="doc-details" id="desc-${doc.id}">
            ${
              isVer
                ? `<span class="doc-details success-text">&#10004; Verified as ${escapeHtml(doc.detectedType || doc.documentType)}</span>`
                : isRej
                ? `<div class="reject-box"><strong>Mismatch:</strong> ${escapeHtml(doc.rejectionReason || 'Uploaded file does not match required document.')} Please upload your correct ${escapeHtml(doc.documentType)}.</div>`
                : `Upload your original ${escapeHtml(doc.documentType)} (PDF, JPG, PNG).`
            }
          </div>

          <!-- Progress bar for upload -->
          <div class="inline-progress" id="progress-${doc.id}">
            <div class="inline-progress-fill" id="progress-fill-${doc.id}"></div>
          </div>

          <!-- Hidden File Input -->
          <input
            type="file"
            id="input-${doc.id}"
            accept="image/jpeg,image/png,image/webp,image/jpg,application/pdf"
            capture="environment"
            style="display:none;"
            onchange="handleFileSelected('${doc.id}', '${escapeHtml(doc.documentType)}', this)"
          />

          <!-- Action Buttons -->
          <div class="action-row" id="actions-${doc.id}">
            ${
              isVer
                ? `
              <button type="button" class="btn-replace" onclick="triggerFileInput('${doc.id}')">
                &#8635; Replace Document
              </button>
            `
                : isRej
                ? `
              <button type="button" class="btn-upload" style="background:#dc2626;" onclick="triggerFileInput('${doc.id}')">
                &#128247; Upload Correct ${escapeHtml(doc.documentType)}
              </button>
            `
                : `
              <button type="button" class="btn-upload" id="btn-upload-${doc.id}" onclick="triggerFileInput('${doc.id}')">
                &#128247; Take Photo or Choose File
              </button>
            `
            }
          </div>
        </div>
      `;
        })
        .join('')}
    </div>

    <!-- Security & Expiration Info -->
    <div class="privacy-badge">
      &#128274; Encrypted transfer &bull; Session valid until ${expiryDate}
    </div>
  </div>

  <div class="footer">
    SmartForm AI &bull; Cyber Café Document Portal<br>
    Files are stored privately and permanently purged upon session completion.
  </div>

  <script>
    const sessionId = ${JSON.stringify(sessionId)};
    const sessionToken = ${JSON.stringify(token)};
    let docRequirements = ${JSON.stringify(docRequirements)};
    const activeUploads = new Set();

    function triggerFileInput(reqId) {
      const input = document.getElementById('input-' + reqId);
      if (input) input.click();
    }

    // Client-side image optimization to accelerate uploads on mobile networks
    async function optimizeImageForUpload(file) {
      if (!file.type.startsWith('image/')) return file;
      if (file.size < 1024 * 1024) return file; // Already < 1MB, proceed directly

      return new Promise((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          const maxDim = 2048; // Preserves fine text for OCR and government seal details
          let width = img.width;
          let height = img.height;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(file);
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            (blob) => {
              if (blob && blob.size < file.size) {
                const compressedFile = new File([blob], file.name.replace(/\\.[^.]+$/, '.jpg'), {
                  type: 'image/jpeg',
                  lastModified: Date.now(),
                });
                resolve(compressedFile);
              } else {
                resolve(file);
              }
            },
            'image/jpeg',
            0.88 // 88% retains sharp contrast for OCR
          );
        };
        img.onerror = () => resolve(file);
        img.src = url;
      });
    }

    // Independent parallel upload & background AI validation
    async function handleFileSelected(reqId, docType, inputElement) {
      if (!inputElement.files || !inputElement.files[0]) return;
      const rawFile = inputElement.files[0];
      
      const card = document.getElementById('card-' + reqId);
      const pill = document.getElementById('pill-' + reqId);
      const desc = document.getElementById('desc-' + reqId);
      const progressWrap = document.getElementById('progress-' + reqId);
      const progressFill = document.getElementById('progress-fill-' + reqId);
      const actions = document.getElementById('actions-' + reqId);

      // 1. Immediately update UI to show optimizing / uploading
      card.className = 'doc-card uploading';
      pill.className = 'doc-pill pill-uploading';
      pill.innerHTML = 'Preparing...';
      desc.innerHTML = 'Optimizing document for fast upload...';
      progressWrap.className = 'inline-progress active';
      progressFill.style.width = '10%';
      actions.innerHTML = '<button type="button" class="btn-upload" disabled><span class="spinner"></span> Uploading...</button>';

      activeUploads.add(reqId);

      try {
        const fileToUpload = await optimizeImageForUpload(rawFile);
        
        // 2. Upload with live XHR progress
        const formData = new FormData();
        formData.append('session', sessionId);
        formData.append('token', sessionToken);
        formData.append('requirementId', reqId);
        formData.append('docType', docType);
        formData.append('file', fileToUpload);

        pill.innerHTML = 'Uploading...';
        desc.innerHTML = 'Uploading ' + escapeHtml(fileToUpload.name) + ' (' + (fileToUpload.size / 1024).toFixed(1) + ' KB)...';

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('POST', '/api/documents/upload');

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 90);
              progressFill.style.width = percent + '%';
              pill.innerHTML = 'Uploading ' + percent + '%';
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const data = JSON.parse(xhr.responseText);
                resolve(data);
              } catch (e) {
                reject(new Error('Invalid response from server'));
              }
            } else {
              try {
                const data = JSON.parse(xhr.responseText);
                reject({ status: xhr.status, data });
              } catch (e) {
                reject({ status: xhr.status, message: xhr.statusText });
              }
            }
          };

          xhr.onerror = () => reject(new Error('Network error during upload'));

          // Transition to AI Validation phase while waiting for server response
          progressFill.style.width = '95%';
          pill.className = 'doc-pill pill-processing';
          pill.innerHTML = 'AI Validating...';
          desc.innerHTML = 'Gemini AI is validating document authenticity and classifying...';

          xhr.send(formData);
        }).then((data) => {
          // 3. Document Accepted & Verified!
          card.className = 'doc-card verified';
          pill.className = 'doc-pill pill-verified';
          pill.innerHTML = '&#10004; Verified';
          progressWrap.className = 'inline-progress';
          desc.innerHTML = '<span class="doc-details success-text">&#10004; Verified as ' + escapeHtml(data.detectedType || docType) + ' (' + Math.round((data.confidence || 0.95) * 100) + '% match)</span>';
          actions.innerHTML = '<button type="button" class="btn-replace" onclick="triggerFileInput(\\'' + reqId + '\\')">&#8635; Replace Document</button>';

          // Update local document record
          const target = docRequirements.find((d) => d.id === reqId);
          if (target) {
            target.status = 'verified';
            target.detectedType = data.detectedType;
          }
          updateOverallProgress();
        }).catch((err) => {
          progressWrap.className = 'inline-progress';
          if (err && err.status === 422) {
            // Wrong document rejected
            const reason = (err.data && (err.data.reason || err.data.message)) || 'The uploaded file does not match the required document.';
            card.className = 'doc-card rejected';
            pill.className = 'doc-pill pill-rejected';
            pill.innerHTML = '&#9888; Wrong Document';
            desc.innerHTML = '<div class="reject-box"><strong>Mismatch Detected:</strong> ' + escapeHtml(reason) + ' Please upload your correct <strong>' + escapeHtml(docType) + '</strong>.</div>';
            actions.innerHTML = '<button type="button" class="btn-upload" style="background:#dc2626;" onclick="triggerFileInput(\\'' + reqId + '\\')">&#128247; Upload Correct ' + escapeHtml(docType) + '</button>';

            const target = docRequirements.find((d) => d.id === reqId);
            if (target) {
              target.status = 'rejected';
              target.rejectionReason = reason;
            }
          } else {
            const msg = (err.data && (err.data.error || err.data.message)) || err.message || 'Upload failed. Please retry.';
            card.className = 'doc-card rejected';
            pill.className = 'doc-pill pill-rejected';
            pill.innerHTML = 'Upload Failed';
            desc.innerHTML = '<div class="reject-box"><strong>Error:</strong> ' + escapeHtml(msg) + '</div>';
            actions.innerHTML = '<button type="button" class="btn-upload" onclick="triggerFileInput(\\'' + reqId + '\\')">&#8635; Retry Upload</button>';
          }
          updateOverallProgress();
        });
      } catch (err) {
        progressWrap.className = 'inline-progress';
        card.className = 'doc-card rejected';
        pill.className = 'doc-pill pill-rejected';
        pill.innerHTML = 'Failed';
        desc.innerHTML = '<div class="reject-box"><strong>Error:</strong> ' + escapeHtml(err.message || 'Error processing file.') + '</div>';
        actions.innerHTML = '<button type="button" class="btn-upload" onclick="triggerFileInput(\\'' + reqId + '\\')">&#8635; Retry Upload</button>';
        updateOverallProgress();
      } finally {
        activeUploads.delete(reqId);
        inputElement.value = ''; // Reset input to allow selecting same file if desired
      }
    }

    function updateOverallProgress() {
      const verified = docRequirements.filter((d) => d.status === 'verified').length;
      const total = docRequirements.length;
      const percent = total > 0 ? Math.round((verified / total) * 100) : 0;

      const progressRatio = document.getElementById('progressRatio');
      const progressBarFill = document.getElementById('progressBarFill');
      const sessionStatusBadge = document.getElementById('sessionStatusBadge');
      const allDoneBanner = document.getElementById('allDoneBanner');

      if (progressRatio) progressRatio.innerText = verified + ' of ' + total + ' verified';
      if (progressBarFill) {
        progressBarFill.style.width = percent + '%';
        if (verified === total && total > 0) {
          progressBarFill.className = 'progress-bar-fill all-verified';
        } else {
          progressBarFill.className = 'progress-bar-fill';
        }
      }

      if (sessionStatusBadge) {
        if (verified === total && total > 0) {
          sessionStatusBadge.className = 'session-status complete';
          sessionStatusBadge.innerText = 'All Verified';
        } else {
          sessionStatusBadge.className = 'session-status';
          sessionStatusBadge.innerText = 'In Progress';
        }
      }

      if (allDoneBanner) {
        if (verified === total && total > 0) {
          allDoneBanner.className = 'all-done-banner show';
        } else {
          allDoneBanner.className = 'all-done-banner';
        }
      }
    }

    // Periodic synchronization to catch operator-side updates
    setInterval(async () => {
      if (activeUploads.size > 0) return; // Don't interrupt while actively uploading
      try {
        const res = await fetch('/upload?session=' + encodeURIComponent(sessionId) + '&token=' + encodeURIComponent(sessionToken), {
          headers: { 'Accept': 'application/json' }
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.documentRequirements) {
            data.documentRequirements.forEach((remoteDoc) => {
              const localDoc = docRequirements.find((d) => d.id === remoteDoc.id);
              if (localDoc && localDoc.status !== remoteDoc.status) {
                localDoc.status = remoteDoc.status;
                localDoc.detectedType = remoteDoc.detectedType;
                localDoc.rejectionReason = remoteDoc.rejectionReason;
                syncCardUI(localDoc);
              }
            });
            updateOverallProgress();
          }
        }
      } catch (e) {}
    }, 3000);

    function syncCardUI(doc) {
      const card = document.getElementById('card-' + doc.id);
      const pill = document.getElementById('pill-' + doc.id);
      const desc = document.getElementById('desc-' + doc.id);
      const actions = document.getElementById('actions-' + doc.id);
      if (!card || !pill || !desc || !actions) return;

      if (doc.status === 'verified') {
        card.className = 'doc-card verified';
        pill.className = 'doc-pill pill-verified';
        pill.innerHTML = '&#10004; Verified';
        desc.innerHTML = '<span class="doc-details success-text">&#10004; Verified as ' + escapeHtml(doc.detectedType || doc.documentType) + '</span>';
        actions.innerHTML = '<button type="button" class="btn-replace" onclick="triggerFileInput(\\'' + doc.id + '\\')">&#8635; Replace Document</button>';
      } else if (doc.status === 'rejected') {
        card.className = 'doc-card rejected';
        pill.className = 'doc-pill pill-rejected';
        pill.innerHTML = '&#9888; Wrong Document';
        desc.innerHTML = '<div class="reject-box"><strong>Mismatch:</strong> ' + escapeHtml(doc.rejectionReason || 'Uploaded file does not match required document.') + '</div>';
        actions.innerHTML = '<button type="button" class="btn-upload" style="background:#dc2626;" onclick="triggerFileInput(\\'' + doc.id + '\\')">&#128247; Upload Correct ' + escapeHtml(doc.documentType) + '</button>';
      }
    }

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

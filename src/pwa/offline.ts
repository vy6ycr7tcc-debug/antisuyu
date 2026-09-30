export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/juzu/sw.js').then(registration => {
        console.log('SW registered: ', registration);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                 // Toast for update
                 const toast = document.createElement('div');
                 toast.innerText = 'Update available! ';
                 toast.style.position = 'absolute';
                 toast.style.top = '10px';
                 toast.style.left = '50%';
                 toast.style.transform = 'translateX(-50%)';
                 toast.style.background = 'white';
                 toast.style.color = 'black';
                 toast.style.padding = '10px';
                 toast.style.zIndex = '9999';

                 const btn = document.createElement('button');
                 btn.innerText = 'Update Now';
                 btn.style.marginLeft = '10px';
                 btn.onclick = () => window.location.reload();
                 toast.appendChild(btn);

                 document.body.appendChild(toast);
              }
            });
          }
        });
      }).catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
    });
  }
}

export function mountOfflineUI() {
  // Wait a tick for UI to initialize
  setTimeout(async () => {
    // 1. Offline boot indicator
    if (!navigator.onLine) {
      const titleContainer = document.getElementById('title-screen');
      if (titleContainer) {
        const indicator = document.createElement('div');
        indicator.innerText = 'Offline Mode';
        indicator.style.position = 'absolute';
        indicator.style.top = '10px';
        indicator.style.right = '10px';
        indicator.style.color = 'red';
        indicator.style.fontWeight = 'bold';
        titleContainer.appendChild(indicator);
      }
    }

    // 2. Settings menu additions
    const settingsPanel = document.querySelector('.settings-panel');
    if (!settingsPanel) return;

    const row = document.createElement('div');
    row.className = 'setting-row';
    row.style.flexDirection = 'column';
    row.style.alignItems = 'flex-start';
    row.style.marginTop = '1rem';

    const pwaTitle = document.createElement('h3');
    pwaTitle.innerText = 'Offline Play';
    pwaTitle.style.marginBottom = '0.5rem';

    const downloadBtn = document.createElement('button');
    downloadBtn.innerText = 'Download for offline play';
    downloadBtn.style.marginBottom = '0.5rem';

    const progressText = document.createElement('div');
    progressText.innerText = '';
    progressText.style.fontSize = '0.8rem';
    progressText.style.marginBottom = '0.5rem';

    const quotaText = document.createElement('div');
    quotaText.style.fontSize = '0.8rem';
    quotaText.style.marginBottom = '0.5rem';

    const clearBtn = document.createElement('button');
    clearBtn.innerText = 'Remove offline data';
    clearBtn.style.marginBottom = '0.5rem';
    clearBtn.style.background = '#aa0000';

    row.appendChild(pwaTitle);
    row.appendChild(downloadBtn);
    row.appendChild(progressText);
    row.appendChild(quotaText);
    row.appendChild(clearBtn);

    settingsPanel.appendChild(row);

    // Initial quota estimate
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usage = ((estimate.usage || 0) / (1024 * 1024)).toFixed(2);
      quotaText.innerText = `Storage used: ${usage} MB`;
    }

    // Logic
    downloadBtn.addEventListener('click', async () => {
      if (!navigator.onLine) {
        progressText.innerText = 'Cannot download while offline.';
        return;
      }

      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
          // First request the asset size to verify quota before proceeding
          const sizeChannel = new MessageChannel();
          sizeChannel.port1.onmessage = async (event) => {
              if (event.data.type === 'ASSET_SIZE') {
                  const assetCount = event.data.count;
                  // Roughly estimate 1MB per asset as a safe upper bound if we don't have exact file sizes.
                  // In a real prod environment we'd inject file sizes during build.
                  const estimatedBytesNeeded = assetCount * 1024 * 1024;

                  if (navigator.storage && navigator.storage.estimate) {
                     const est = await navigator.storage.estimate();
                     const available = (est.quota || 0) - (est.usage || 0);
                     if (available < estimatedBytesNeeded) {
                        progressText.innerText = `Need approx ${Math.ceil(estimatedBytesNeeded / (1024*1024))} MB. Only ${((available)/(1024*1024)).toFixed(2)} MB available.`;
                        return;
                     }
                  }

                  // Proceed with download
                  downloadBtn.disabled = true;
                  progressText.innerText = 'Starting download... 0%';

                  const messageChannel = new MessageChannel();
                  messageChannel.port1.onmessage = (dlEvent) => {
                    if (dlEvent.data.type === 'PROGRESS') {
                      progressText.innerText = `Downloading... ${dlEvent.data.progress}%`;
                    } else if (dlEvent.data.type === 'COMPLETE') {
                      progressText.innerText = 'Ready to play offline';
                      downloadBtn.innerText = 'Downloaded';
                      updateQuota();
                    } else if (dlEvent.data.type === 'ERROR') {
                      progressText.innerText = 'Error: ' + dlEvent.data.error;
                      downloadBtn.disabled = false;
                    }
                  };

                  navigator.serviceWorker!.controller!.postMessage(
                    { type: 'DOWNLOAD_OFFLINE' },
                    [messageChannel.port2]
                  );
              }
          };
          navigator.serviceWorker.controller.postMessage({ type: 'GET_ASSET_SIZE' }, [sizeChannel.port2]);
      } else {
        progressText.innerText = 'Service Worker not active. Reload and try again.';
        downloadBtn.disabled = false;
      }
    });

    clearBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to remove offline data? Saves will not be deleted.')) {
         if (navigator.serviceWorker && navigator.serviceWorker.controller) {
            const messageChannel = new MessageChannel();
            messageChannel.port1.onmessage = (event) => {
               if (event.data.type === 'CLEARED') {
                  progressText.innerText = 'Offline data removed.';
                  downloadBtn.innerText = 'Download for offline play';
                  downloadBtn.disabled = false;
                  updateQuota();
               }
            };
            navigator.serviceWorker.controller.postMessage(
               { type: 'CLEAR_OFFLINE' },
               [messageChannel.port2]
            );
         }
      }
    });

    async function updateQuota() {
      if (navigator.storage && navigator.storage.estimate) {
        const estimate = await navigator.storage.estimate();
        const usage = ((estimate.usage || 0) / (1024 * 1024)).toFixed(2);
        quotaText.innerText = `Storage used: ${usage} MB`;
      }
    }
  }, 1000); // 1s delay to ensure UI is mounted
}

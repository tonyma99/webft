import './style.css'
import { connectionStateColor, formatBytes, formatDownloadProgress, saveBlob } from './lib/helpers';
import { getParams } from './lib/params'
import { send } from './lib/send'
import { connect } from './lib/receive'

let file: File; 

// Handle file input using the input element
function inputHandler(e: Event) {-
  e.preventDefault();
  if (fileInput.files) {
    file = fileInput.files[0];
    selectedFile.textContent = `📦 ${file.name} (${formatBytes(file.size)})`;
    sendButton.disabled = false;
  }
}

// Handle file input using drag and drop
function dropHandler(e: DragEvent) {
  e.preventDefault();
  fileDrop.classList.remove("dragging");
  if (e.dataTransfer?.items) {
    fileInput.files = e.dataTransfer.files
  }
  inputHandler(e);
}

// Prevent the browser from opening the file when it is dropped
function dragOverHandler(e: DragEvent) {
  e.preventDefault();
}

// Check if the user is sending or receiving
const params = getParams();

const fileSelect = document.getElementById("fileSelect") as HTMLButtonElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;
const fileDrop = document.getElementById("fileDrop") as HTMLDivElement;
const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
const downloadButton = document.getElementById("downloadButton") as HTMLButtonElement;
const fileInfo = document.getElementById("fileInfo") as HTMLSpanElement;
const selectedFile = document.getElementById("selectedFile") as HTMLSpanElement;
const downloadProgress = document.getElementById("downloadProgress") as HTMLSpanElement;

if (params.receive) {
  (document.getElementById("send") as HTMLDivElement).remove();

  try {
    const { pc, dc } = await connect(params.receive);

    pc.onconnectionstatechange = () => {
      const connectionState = document.getElementById("connectionState") as HTMLSpanElement;
      connectionState.textContent = pc.connectionState;
      connectionState.style.color = connectionStateColor(pc.connectionState);
    }

    dc.onopen = async () => {
      let filename: string;
      let size: number;
      let bytesReceived = 0;
      let incomingData: ArrayBuffer[] = [];
      dc.onmessage = async (event) => {
        const data = event.data;
        if (!(data instanceof ArrayBuffer) && !filename && !size) {
          // Receive transfer details
          ({filename, size} = JSON.parse(data));
          console.log(`Receiving file: ${filename} (${formatBytes(size)})`);
          fileInfo.textContent = `📦 ${filename} (${formatBytes(size)})`;
          downloadButton.hidden = false;
          downloadButton.disabled = false;
          downloadButton.onclick = () => {
            dc.send('download');
            downloadButton.disabled = true;
          }
        } else if (data instanceof ArrayBuffer && filename && size) {
          // Receive file data
          incomingData.push(data);
          bytesReceived += data.byteLength;
          downloadProgress.textContent = formatDownloadProgress(bytesReceived, size);
          if (bytesReceived >= size) {
            dc.send('end');
            dc.close();
            pc.close();
            const blob = new Blob(incomingData);
            saveBlob(blob, filename);
          }
        }
      }
    }
  } catch (e ) {
    console.error(e);
    fileInfo.textContent = (e as Error).message as string;
  }
} else {
  (document.getElementById("receive") as HTMLDivElement).remove();

  fileSelect.onclick = () => fileInput.click();
  fileInput.onchange = inputHandler
  fileDrop.ondrop = dropHandler;
  fileDrop.ondragover = dragOverHandler;
  fileDrop.ondragenter = () => fileDrop.classList.add("dragging");
  fileDrop.ondragleave = () => fileDrop.classList.remove("dragging");
  sendButton.onclick = async () => await send(file);
}

import './style.css'
import { getParams } from './lib/params'
import { firebaseConfig, iceServers } from './lib/config'

// Use Firebase for signaling
import { initializeApp } from 'firebase/app'
import { addDoc, collection, doc, getDoc, getFirestore, onSnapshot, setDoc } from 'firebase/firestore'

let file: File;

function showFile() {
  selectedFiles.style.display = "flex";
  fileDrop.style.display = "none";

  (document.getElementById("sendFile") as HTMLSpanElement).innerHTML = `📦 ${file.name} (${file.size / 1000}KB)`;
}

// Handle file input using the input element
function inputHandler(e: Event) {
  e.preventDefault();
  if (fileInput.files) {
    file = fileInput.files[0];
  }
  showFile();
}

// Handle file input using drag and drop
function dropHandler(e: DragEvent) {
  e.preventDefault();
  if (e.dataTransfer?.items) {
    file = [...e.dataTransfer.items][0].getAsFile() as File;
  }
  showFile();
}

// Prevent the browser from opening the file when it is dropped
function dragOverHandler(e: DragEvent) {
  e.preventDefault();
}

async function sendFiles() {
  if (!file) {
    alert("No files selected");
    return;
  }

  sendButton.disabled = true;

  // Create a Firestore document to store the manifest and call information
  const transferDoc = await addDoc(transfersCollectionRef, { 
    filename: file.name,
    size: file.size,
  });
  const transferId = transferDoc.id;
  const connectionsCollectionRef = collection(transfersCollectionRef, transferId, "connections");

  // Show download link
  const el = '<a target="_blank" href="/?receive=' + transferId + '">link</a>';
  (document.getElementById("send") as HTMLDivElement).innerHTML = el;

  const answeredConnections: string[] = [];

  // Listen for incoming offers
  onSnapshot(connectionsCollectionRef, async (docRefs) => {
    docRefs.forEach(async (docRef) => {
      if (!answeredConnections.includes(docRef.id)) {
        const data = docRef.data();
        answeredConnections.push(docRef.id);

        const answerCandidatesCollection = collection(docRef.ref, "answerCandidates");
        const offerCandidatesCollection = collection(docRef.ref, "offerCandidates");

        const connectionState = document.getElementById("connectionState") as HTMLSpanElement;
        pc.onconnectionstatechange = () => {
          connectionState.textContent = pc.connectionState;
          connectionState.style.color = pc.connectionState === "connected" ? "green" : pc.connectionState === "disconnected" ? "red" : "orange";
          if (pc.connectionState === "connected") {
            downloadButton.disabled = false;
          } else {
            downloadButton.disabled = true;
          }
        }

        // Get ICE candidates
        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            await addDoc(answerCandidatesCollection, event.candidate.toJSON());
          }
        }

        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        await setDoc(docRef.ref, { answer }, { merge: true });

        onSnapshot(offerCandidatesCollection, async (item) => {
          item.docChanges().forEach((change) => {
            if (change.type === "added") {
              const candidate = new RTCIceCandidate(change.doc.data());
              pc.addIceCandidate(candidate);
            }
          });
        });
      }
    });
  });

  pc.addEventListener('datachannel', async (event) => {
    const dc = event.channel;
    dc.addEventListener('message', async (event) => {
      console.log('Received message:', event.data);
      if (event.data === 'download') {
        const reader = new FileReader();
        let currentChunk = 0;
        const chunkSize = 4096;
        dc.send(JSON.stringify({ name: file.name, size: file.size }));
        console.log('Sending file:', file.name, file.size);
        reader.readAsArrayBuffer(file.slice(0, Math.min(chunkSize, file.size)));
        reader.onload = () => {
          dc.send(reader.result as ArrayBuffer);
          currentChunk++;
          if (currentChunk * chunkSize < file.size) {
            reader.readAsArrayBuffer(file.slice(currentChunk * chunkSize, Math.min((currentChunk + 1) * chunkSize, file.size)));
            }
        };
        if (currentChunk * chunkSize >= file.size) {
          reader.abort();
        }
      } else if (event.data === 'end') {
        (document.getElementById("connectionState") as HTMLSpanElement).remove();
        (document.getElementById("send") as HTMLDivElement).innerHTML = "complete";
        dc.close();
        pc.close()
        await setDoc(transferDoc, { completed: true }, { merge: true });
      }
    });
  });
}

async function downloadFiles(dc: RTCDataChannel) {
  downloadButton.disabled = true;
  let manifestReceived = false;
  let fileName: string;
  let fileSize: number;
  let bytesReceived = 0;
  let incomingData = [];
  dc.addEventListener('message', (event) => {
    if (!(event.data instanceof ArrayBuffer)) {
      const data = JSON.parse(event.data);
      console.log(`Received file: ${data.name} (${data.size} bytes)`);
      fileName = data.name;
      fileSize = data.size;
      manifestReceived = true;
    }
    if (manifestReceived) {
      if (event.data instanceof ArrayBuffer) {
        incomingData.push(event.data);
        bytesReceived += event.data.byteLength;
        (document.getElementById("downloadProgress") as HTMLSpanElement).textContent = `${bytesReceived} / ${fileSize} bytes`;
        if (bytesReceived === fileSize) {
          (document.getElementById("connectionState") as HTMLSpanElement).remove();
          (document.getElementById("downloadProgress") as HTMLSpanElement).textContent = "complete";
          dc.send('end');
          dc.close();
          pc.close();
          const blob = new Blob(incomingData);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(url);
        }
      }
    }
  });
  dc.send('download');
}

const fileInput = document.getElementById("file") as HTMLInputElement;
const fileDrop = document.getElementById("dropZone") as HTMLDivElement;
const selectedFiles = document.getElementById("selectedFiles") as HTMLDivElement;
const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
const downloadButton = document.getElementById("downloadButton") as HTMLButtonElement;

fileInput.addEventListener("change", inputHandler);
fileDrop.addEventListener("drop", dropHandler);
fileDrop.addEventListener("dragover", dragOverHandler);
fileDrop.addEventListener("dragenter", () => {
  fileDrop.style.backgroundColor = "rgba(0, 0, 0, 0.1)"
  fileDrop.style.zIndex = "999";
});
fileDrop.addEventListener("dragleave", () => {
  fileDrop.style.backgroundColor = "rgba(0, 0, 0, 0)"
  fileDrop.style.zIndex = "0";
});
fileDrop.addEventListener("drop", () => {
  fileDrop.style.backgroundColor = "rgba(0, 0, 0, 0)"
  fileDrop.style.zIndex = "0";
});
sendButton.addEventListener("click", sendFiles);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const transfersCollectionRef = collection(db, "transfers");

// Initialize WebRTC
const pc = new RTCPeerConnection({ iceServers });

// Check if the user is sending or receiving
const params = getParams();

if (params.receive) {
  (document.getElementById("send") as HTMLDivElement).remove();
  downloadButton.disabled = true;

  const callDoc = await getDoc(doc(transfersCollectionRef, params.receive));
  const dc = pc.createDataChannel('channel');
  
  if (callDoc.exists()) {
    const data = callDoc.data();
    
    if (data.completed) {
      (document.getElementById("receive") as HTMLDivElement).innerHTML = "expired";
    }

    const fileList = document.getElementById("receiveFile") as HTMLDivElement;
    fileList.innerHTML = "";
    const p = document.createElement("p");
    p.textContent = `📦 ${data.filename} (${data.size / 1000}KB)`;
    fileList.appendChild(p);
    
    const connectionsCollectionRef = collection(transfersCollectionRef, params.receive, "connections");
    const connectionRef = doc(connectionsCollectionRef);
    const answerCandidatesCollection = collection(connectionRef, "answerCandidates");
    const offerCandidatesCollection = collection(connectionRef, "offerCandidates");

    const connectionState = document.getElementById("connectionState") as HTMLSpanElement;
    pc.onconnectionstatechange = () => {
      connectionState.textContent = pc.connectionState;
      connectionState.style.color = pc.connectionState === "connected" ? "green" : pc.connectionState === "disconnected" ? "red" : "orange";
      if (pc.connectionState === "connected") {
        downloadButton.disabled = false;
      } else {
        downloadButton.disabled = true;
      }
    }

    downloadButton.onclick = () => downloadFiles(dc);

    // Get ICE candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        addDoc(offerCandidatesCollection, event.candidate.toJSON())
      };
    }

    // Send and offer to the sender
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await setDoc(connectionRef, { offer }, { merge: true});

    // Listen for incoming answers
    const unsubAnswers = onSnapshot(connectionRef, async (item) => {
      const data = item.data();
      if (data) {
        if (!pc.currentRemoteDescription && data?.answer) {
          const answerDescription = new RTCSessionDescription(data.answer);
          pc.setRemoteDescription(answerDescription);
          unsubAnswers();
        }
      }
    });

    // Listen for incoming ICE candidates
    onSnapshot(answerCandidatesCollection, async (item) => {
      item.docChanges().forEach((change) => {
        if (change.type === "added") {
          const candidate = new RTCIceCandidate(change.doc.data());
          pc.addIceCandidate(candidate);
        }
      });
    });
  } else {
    (document.getElementById("receive") as HTMLDivElement).innerHTML = "invalid";
  }
} else {
  (document.getElementById("receive") as HTMLDivElement).remove();
  fileDrop.style.display = "block";
}

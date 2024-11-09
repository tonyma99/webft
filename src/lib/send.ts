import { initializeApp } from 'firebase/app'
import { addDoc, collection, getFirestore, onSnapshot, setDoc } from 'firebase/firestore'
import { firebaseConfig, iceServers } from './config';
import { connectionStateColor, formatDownloadProgress } from './helpers';

const sendButton = document.getElementById("sendButton") as HTMLButtonElement;

function createQRElement(url: string): HTMLImageElement {
  const qr = document.createElement("img");
  qr.id = "qr";
  qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${url}`;
  qr.alt = "QR code";
  qr.style.width = "150px";
  qr.style.height = "150px";
  return qr;
}

export async function send(file: File) {
  // Update the user view
  const selectedFile = document.getElementById("selectedFile")?.cloneNode(true) as HTMLSpanElement;
  (document.getElementById("send") as HTMLDivElement).innerHTML = "";
	sendButton.disabled = true;
  
	// Initialize Firestore (for signalling)
	const app = initializeApp(firebaseConfig);
	const db = getFirestore(app);
	const transfersCollection = collection(db, "transfers");

	// Initalize WebRTC
	const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 10 });

  // Create a Firestore document to store file data and signaling data
  const transferDoc = await addDoc(transfersCollection, { 
    filename: file.name,
    size: file.size,
  });
  const transferId = transferDoc.id;
  const connectionsCollection = collection(transfersCollection, transferId, "connections");

  // Show download link
  const qrLink = `${import.meta.env.VITE_BASE_URL}?receive=${transferId}`
  const qrEl = createQRElement(qrLink);
  (document.getElementById("send") as HTMLDivElement).appendChild(qrEl);
	console.log(qrLink)

  // Listen for incoming offers
  onSnapshot(connectionsCollection, async (items) => {
		items.docChanges().forEach(async (change) => {
			if (change.type === "added") {
        const data = change.doc.data();

        const answerCandidatesCollection = collection(change.doc.ref, "answerCandidates");
        const offerCandidatesCollection = collection(change.doc.ref, "offerCandidates");

        // Show connection state to user
        const connectionState = document.getElementById("connectionState") as HTMLSpanElement;
        pc.onconnectionstatechange = () => {
          connectionState.textContent = pc.connectionState;
          connectionState.style.color = connectionStateColor(pc.connectionState);
        }

        // Get ICE candidates
        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            await addDoc(answerCandidatesCollection, event.candidate.toJSON());
          }
        }

        // Set descriptions and create answer
        await pc.setRemoteDescription(data.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await setDoc(change.doc.ref, { answer }, { merge: true });

        // Listen for incoming ICE candidates
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

  // Listen for data channel creation
  pc.addEventListener('datachannel', async (event) => {
    // On data channel open, send file details
    const dc = event.channel;
    dc.bufferedAmountLowThreshold = 65536;
    dc.send(JSON.stringify({
      filename: file.name,
      size: file.size
   }));

    dc.addEventListener('message', async (event) => {
      if (event.data === 'download') {
        // Update the user view
        (document.getElementById("qr") as HTMLImageElement).remove();
        (document.getElementById("send") as HTMLDivElement).appendChild(selectedFile);
        const downloadProgress = document.createElement("span");
        downloadProgress.id = "downloadProgress";
        (document.getElementById("send") as HTMLDivElement).appendChild(downloadProgress);

        // On download request, send file data
        let currentChunk = 0;
        let bytesSent = 0;
        const chunkSize = 8196;
        const reader = new FileReader();

        reader.readAsArrayBuffer(file.slice(0, Math.min(chunkSize, file.size)));
        bytesSent += Math.min(chunkSize, file.size);

        reader.onload = () => {
          if (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
            dc.onbufferedamountlow = () => {
              dc.send(reader.result as ArrayBuffer);
              currentChunk++;
              bytesSent += Math.min(chunkSize, file.size - currentChunk * chunkSize);
              if (currentChunk * chunkSize < file.size) {
                reader.readAsArrayBuffer(file.slice(currentChunk * chunkSize, Math.min((currentChunk + 1) * chunkSize, file.size)));
              }
            }
          } else {
            dc.send(reader.result as ArrayBuffer);
            currentChunk++;
            bytesSent += Math.min(chunkSize, file.size - currentChunk * chunkSize);
            if (currentChunk * chunkSize < file.size) {
              reader.readAsArrayBuffer(file.slice(currentChunk * chunkSize, Math.min((currentChunk + 1) * chunkSize, file.size)));
            }
          };
          // Show download progress
          (document.getElementById("downloadProgress") as HTMLDivElement).innerHTML = formatDownloadProgress(bytesSent, file.size);
        }
        if (currentChunk * chunkSize >= file.size) {
          reader.abort();
        }
      } else if (event.data === 'end') {
        // On end signal, close data channel and peer connection
        dc.close();
        pc.close()
        await setDoc(transferDoc, { completed: true }, { merge: true });
      }
    });
  });
}

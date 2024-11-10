import { initializeApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { addDoc, collection, getFirestore, onSnapshot, setDoc } from 'firebase/firestore'
import { firebaseConfig, iceServers } from './config';
import { connectionStateColor, formatDownloadProgress } from './helpers';

const sendContainer = document.getElementById("send") as HTMLDivElement;
const sendButton = document.getElementById("sendButton") as HTMLButtonElement;
const connectionState = document.getElementById("connectionState") as HTMLSpanElement;

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
  sendContainer.innerHTML = "";
	sendButton.disabled = true;
  
	// Initialize Firestore (for signalling)
	const app = initializeApp(firebaseConfig);
	const db = getFirestore(app);
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(import.meta.env.VITE_RECAPTCHA_SITE_KEY),
    isTokenAutoRefreshEnabled: true
  });

	const transfersCollection = collection(db, "transfers");

	// Initalize WebRTC
	const pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 10 });

  // Create a Firestore document to store file data and signaling data
  const transferDoc = await addDoc(transfersCollection, { 
    completed: false,
  });
  const transferId = transferDoc.id;
  const connectionsCollection = collection(transfersCollection, transferId, "connections");

  // Show download link
  const qrLink = `${import.meta.env.VITE_BASE_URL}?receive=${transferId}`
  const qrEl = createQRElement(qrLink);
  sendContainer.appendChild(qrEl);
	console.log(qrLink)

  // Listen for incoming offers
  onSnapshot(connectionsCollection, async (items) => {
		items.docChanges().forEach(async (change) => {
			if (change.type === "added") {
        const data = change.doc.data();

        const answerCandidatesCollection = collection(change.doc.ref, "answerCandidates");
        const offerCandidatesCollection = collection(change.doc.ref, "offerCandidates");

        // Show connection state to user
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
    dc.send(JSON.stringify({
      filename: file.name,
      size: file.size
    }));

    dc.addEventListener('message', async (event) => {
      if (event.data === 'download') {
        // Update the user view
        qrEl.remove();
        const downloadProgress = document.createElement("span");
        downloadProgress.id = "downloadProgress";
        sendContainer.appendChild(selectedFile);
        sendContainer.appendChild(downloadProgress);

        // On download request, send file data
        let currentChunk = 0;
        let bytesSent = 0;
        const chunkSize = 8192;
        const reader = new FileReader();

        reader.onload = () => {
          dc.send(reader.result as ArrayBuffer);
          currentChunk++;
          if (currentChunk * chunkSize < file.size) {
            readChunk(currentChunk);
          }
          downloadProgress.innerHTML = formatDownloadProgress(bytesSent, file.size);
        }

        const readChunk = (chunk: number) => {
          const start = chunk * chunkSize;
          const end = Math.min((chunk + 1) * chunkSize, file.size);
          bytesSent += end - start;
          if (start > file.size) return;
          reader.readAsArrayBuffer(file.slice(start, end));
        }
        readChunk(currentChunk);
      } else if (event.data === 'end') {
        // On end signal, close data channel and peer connection
        dc.close();
        pc.close();
        await setDoc(transferDoc, { completed: true }, { merge: true });
      }
    });
  });
}

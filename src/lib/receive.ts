import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';
import { addDoc, collection, doc, getDoc, getFirestore, onSnapshot, setDoc } from 'firebase/firestore'
import { firebaseConfig, iceServers } from './config';

export async function connect(id: string): Promise<{ pc: RTCPeerConnection, dc: RTCDataChannel }> {
  (document.getElementById("fileInfo") as HTMLDivElement).innerHTML = "waiting";

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
	const dc = pc.createDataChannel('channel');
  
	const callDoc = await getDoc(doc(transfersCollection, id));

  if (callDoc.exists()) {
    const transferData = callDoc.data();
    
    if (transferData.completed) {
      throw new Error("transfer already completed");
    }
    
    const connectionsCollection = collection(transfersCollection, id, "connections");
    const connection = doc(connectionsCollection);
    const answerCandidatesCollection = collection(connection, "answerCandidates");
    const offerCandidatesCollection = collection(connection, "offerCandidates");

    // Get ICE candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        addDoc(offerCandidatesCollection, event.candidate.toJSON());
      };
    }

    // Create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await setDoc(connection, { offer }, { merge: true});

    // Listen for incoming answers
    const unsub = onSnapshot(connection, async (item) => {
			const connectionData = item.data();
			if (!pc.currentRemoteDescription && connectionData?.answer) {
				const answerDescription = new RTCSessionDescription(connectionData?.answer);
				pc.setRemoteDescription(answerDescription);
				unsub();
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
		throw new Error("invalid transfer");
	}

	return { pc, dc };
}

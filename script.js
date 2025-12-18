// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyB5DEX0fuSjTud04-mR__GDpiu1-vk9SIY",
    authDomain: "memory-game-66dad.firebaseapp.com",
    databaseURL: "https://memory-game-66dad-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "memory-game-66dad",
    storageBucket: "memory-game-66dad.firebasestorage.app",
    messagingSenderId: "94001818458",
    appId: "1:94001818458:web:95184599a49e78d286e163"
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
const db = firebase.database();

const icons = ['🍎','🍌','🍇','🍒','🍉','🥝','🍍','🥥'];
let user = "";
let roomCode = "";
let isHost = false;
let dbRef = null;

// Local Game State
let localCards = []; 
let localMatched = []; 
let firstCard = null;
let isLocked = false;
let myScore = 0;
let lastCardsString = ""; 

// Timer State
let timerInterval = null;
let seconds = 0;

// --- AUDIO HELPER ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSound(type) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    if (type === 'match') {
        osc.frequency.setValueAtTime(600, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    } else {
        osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        osc.start(); osc.stop(audioCtx.currentTime + 0.2);
    }
}

// --- SESSION ---
function saveSession() { sessionStorage.setItem("memGameSession", JSON.stringify({ user, roomCode, isHost })); }
function getSession() { const data = sessionStorage.getItem("memGameSession"); return data ? JSON.parse(data) : null; }
function clearSession() { sessionStorage.removeItem("memGameSession"); }

window.onload = () => {
    const session = getSession();
    if (session && session.user && session.roomCode) {
        user = session.user; roomCode = session.roomCode; isHost = session.isHost;
        enterGameScreen();
    }
};

// --- HELPERS ---
function shuffle(array) { return array.sort(() => Math.random() - 0.5); }
function getEl(id) { return document.getElementById(id); }

// --- LOBBY ---
function createRoom(){
    const name = getEl("playerName").value.trim();
    const room = getEl("roomName").value.trim();
    const pass = getEl("roomPass").value.trim();
    if(!name || !room) return alert("Fill name and room");

    user = name; roomCode = room; isHost = true;
    saveSession();
    db.ref("rooms/"+roomCode).set({
        pass: pass, host: user, state: "waiting", winner: "",
        cards: shuffle([...icons, ...icons]),
        players: { [user]: { score: 0 } }
    });
    enterGameScreen();
}

function joinRoom(){
    const name = getEl("playerName").value.trim();
    const room = getEl("roomName").value.trim();
    const pass = getEl("roomPass").value.trim();
    if(!name || !room) return alert("Fill name and room");

    user = name; roomCode = room;
    db.ref("rooms/"+roomCode).once("value", s => {
        if(!s.exists()) return alert("No room");
        if(s.val().pass !== pass) return alert("Wrong pass");
        saveSession();
        db.ref("rooms/"+roomCode+"/players/"+user).update({ score: 0 });
        enterGameScreen();
    });
}

function enterGameScreen() {
    getEl("login").classList.add("hidden");
    getEl("game").classList.remove("hidden");
    getEl("roomTitle").innerText = "Room: " + roomCode;
    getEl("lobbyRoomName").innerText = roomCode;
    dbRef = db.ref("rooms/"+roomCode);

    dbRef.on("value", snapshot => {
        const data = snapshot.val();
        if(!data) { location.reload(); return; }

        // Sync Cards/Board
        const currentCardsStr = JSON.stringify(data.cards);
        if (currentCardsStr !== lastCardsString) {
            lastCardsString = currentCardsStr;
            setupLocalBoard(data.cards);
        }

        // State Management
        if (data.state === "waiting") {
            if (isHost && Object.keys(data.players || {}).length === 2) dbRef.update({ state: "playing" });
            getEl("lobby").classList.remove("hidden");
            getEl("gameArea").classList.add("hidden");
            getEl("endScreen").classList.add("hidden");
        } else if (data.state === "playing") {
            getEl("lobby").classList.add("hidden");
            getEl("gameArea").classList.remove("hidden");
            getEl("endScreen").classList.add("hidden");
            if(!timerInterval) startTimer();
        } else if (data.state === "ended") {
            stopTimer();
            showEndScreen(data.winner);
        }
        updateScoresUI(data.players || {});
        renderChat(data.chat || {});
    });
}

// --- GAMEPLAY ---
function setupLocalBoard(cardIcons) {
    localCards = cardIcons; localMatched = []; firstCard = null; isLocked = false; myScore = 0;
    const grid = getEl("grid"); grid.innerHTML = "";
    localCards.forEach((icon, index) => {
        const card = document.createElement("div");
        card.className = "card";
        card.onclick = () => handleCardClick(card, icon, index);
        grid.appendChild(card);
    });
}

function handleCardClick(cardDiv, icon, index) {
    if (isLocked || localMatched.includes(index) || cardDiv.classList.contains("flipped")) return;
    cardDiv.classList.add("flipped");
    cardDiv.innerText = icon;

    if (!firstCard) {
        firstCard = { index, icon, el: cardDiv };
    } else {
        isLocked = true;
        if (firstCard.icon === icon) {
            playSound('match');
            localMatched.push(firstCard.index, index);
            cardDiv.classList.add("matched"); firstCard.el.classList.add("matched");
            myScore++;
            dbRef.child("players/"+user).update({ score: myScore });
            if (myScore === 8) dbRef.update({ state: "ended", winner: user });
            firstCard = null; isLocked = false;
        } else {
            setTimeout(() => {
                playSound('error');
                cardDiv.classList.remove("flipped"); cardDiv.innerText = "";
                firstCard.el.classList.remove("flipped"); firstCard.el.innerText = "";
                firstCard = null; isLocked = false;
            }, 700);
        }
    }
}

// --- TIMER ---
function startTimer() {
    seconds = 0;
    timerInterval = setInterval(() => {
        seconds++;
        const m = Math.floor(seconds/60).toString().padStart(2,'0');
        const s = (seconds%60).toString().padStart(2,'0');
        getEl("timer").innerText = `${m}:${s}`;
    }, 1000);
}
function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

// --- UI ---
function updateScoresUI(players) {
    Object.entries(players).forEach(([pName, pData]) => {
        if(pName === user) getEl("myScoreEl").innerText = `You: ${pData.score}`;
        else getEl("opScoreEl").innerText = `${pName}: ${pData.score}`;
    });
}

function showEndScreen(winner) {
    getEl("endScreen").classList.remove("hidden");
    getEl("endTitle").innerText = winner === user ? "Victory! 🏆" : "Defeat 💀";
    getEl("endTitle").className = "result-title " + (winner === user ? "won" : "lost");
    getEl("endMessage").innerText = winner === user ? "You were faster!" : winner + " won.";
    if(isHost) getEl("hostControls").classList.remove("hidden");
    else getEl("waitControls").classList.remove("hidden");
}

function restartGame() {
    if(!isHost) return;
    const newCards = shuffle([...icons, ...icons]);
    dbRef.child("players").once("value", s => {
        let updates = {};
        s.forEach(p => { updates[p.key + "/score"] = 0; });
        dbRef.child("players").update(updates);
    });
    dbRef.update({ cards: newCards, state: "playing", winner: "", chat: {} });
}

function closeRoom() { if(confirm("Close room?")) { dbRef.remove(); location.reload(); } }
function copyCode() { navigator.clipboard.writeText(roomCode); alert("Copied!"); }
function renderChat(c) { 
    const b = getEl("chat"); b.innerHTML = ""; 
    Object.values(c).forEach(m => { const d = document.createElement("div"); d.innerText = m; b.appendChild(d); });
    b.scrollTop = b.scrollHeight;
}
function sendChat(e) { 
    if(e.key === "Enter" && e.target.value.trim()) { 
        dbRef.child("chat").push(user + ": " + e.target.value); 
        e.target.value = ""; 
    } 
}

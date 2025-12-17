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
  
  const icons = ['🍎','🍌','🍇','🍒','🍉','🥝','🍍','🥥']; // 8 Pairs
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
  
  // --- SESSION HANDLING (FIX FOR REFRESH) ---
  function saveSession() {
      sessionStorage.setItem("memGameSession", JSON.stringify({ user, roomCode, isHost }));
  }
  
  function getSession() {
      const data = sessionStorage.getItem("memGameSession");
      return data ? JSON.parse(data) : null;
  }
  
  function clearSession() {
      sessionStorage.removeItem("memGameSession");
  }
  
  // Check for session on load
  window.onload = () => {
      const session = getSession();
      if (session && session.user && session.roomCode) {
          // Restore variables
          user = session.user;
          roomCode = session.roomCode;
          isHost = session.isHost;
          
          console.log("Session restored for:", user);
          enterGameScreen();
      }
  };
  
  // --- HELPERS ---
  function shuffle(array) { return array.sort(() => Math.random() - 0.5); }
  function getEl(id) { return document.getElementById(id); }
  function getInputs() {
    return {
      name: getEl("playerName").value.trim(),
      room: getEl("roomName").value.trim(),
      pass: getEl("roomPass").value.trim()
    };
  }
  
  // --- LOBBY LOGIC ---
  function createRoom(){
    const i = getInputs();
    if(!i.name || !i.room) return alert("Fill in name and room");
  
    user = i.name;
    roomCode = i.room;
    isHost = true;
    
    saveSession(); // Save login info
  
    // Initialize Room
    db.ref("rooms/"+roomCode).set({
      pass: i.pass,
      host: user,
      cards: shuffle([...icons, ...icons]), 
      state: "waiting", 
      winner: "",
      players: {
          [user]: { score: 0 }
      }
    });
    
    enterGameScreen();
  }
  
  function joinRoom(){
    const i = getInputs();
    if(!i.name || !i.room) return alert("Fill in name and room");
  
    user = i.name;
    roomCode = i.room;
  
    db.ref("rooms/"+roomCode).once("value", s => {
      if(!s.exists()) return alert("Room does not exist");
      const val = s.val();
  
      if(val.pass !== i.pass) return alert("Wrong password");
      
      const pCount = val.players ? Object.keys(val.players).length : 0;
      // Allow rejoin if user already exists in DB
      if(pCount >= 2 && !val.players[user]) return alert("Room is full!");
  
      saveSession(); // Save login info
  
      // Add Player
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
  
    // --- MAIN LISTENER ---
    dbRef.on("value", snapshot => {
      const data = snapshot.val();
      if(!data) { 
          alert("Room closed by host"); 
          clearSession();
          location.reload(); 
          return; 
      }
  
      // 1. Check Player Count to Start Game
      const players = data.players || {};
      const playerNames = Object.keys(players);
  
      // Ensure localCards are loaded if we refreshed mid-game
      if (data.cards && localCards.length === 0) {
          setupLocalBoard(data.cards);
      }
  
      // The HOST checks if it's time to start
      if (isHost && data.state === "waiting" && playerNames.length === 2) {
          dbRef.update({ state: "playing" });
      }
  
      // 2. Manage Screens
      if (data.state === "waiting") {
          getEl("lobby").classList.remove("hidden");
          getEl("gameArea").classList.add("hidden");
          getEl("endScreen").classList.add("hidden");
      } else if (data.state === "playing") {
          getEl("lobby").classList.add("hidden");
          getEl("gameArea").classList.remove("hidden");
          getEl("endScreen").classList.add("hidden");
      } else if (data.state === "ended") {
          showEndScreen(data.winner);
      }
  
      // 3. Update Scores UI
      updateScoresUI(players);
  
      // 4. Chat
      renderChat(data.chat || {});
    });
  }
  
  // --- GAME LOGIC (LOCAL) ---
  function setupLocalBoard(cardIcons) {
      localCards = cardIcons;
      localMatched = [];
      firstCard = null;
      isLocked = false;
      myScore = 0;
      
      const grid = getEl("grid");
      grid.innerHTML = "";
  
      localCards.forEach((icon, index) => {
          const card = document.createElement("div");
          card.className = "card";
          card.dataset.index = index;
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
              localMatched.push(firstCard.index);
              localMatched.push(index);
              
              firstCard.el.classList.add("matched");
              cardDiv.classList.add("matched");
              
              myScore++;
              dbRef.child("players/"+user).update({ score: myScore });
  
              if (myScore === 8) {
                  dbRef.update({ state: "ended", winner: user });
              }
  
              firstCard = null;
              isLocked = false;
          } else {
              setTimeout(() => {
                  firstCard.el.classList.remove("flipped");
                  firstCard.el.innerText = "";
                  cardDiv.classList.remove("flipped");
                  cardDiv.innerText = "";
                  firstCard = null;
                  isLocked = false;
              }, 800);
          }
      }
  }
  
  // --- UI UPDATES ---
  function updateScoresUI(players) {
      let opName = "Opponent";
      let opScore = 0;
  
      Object.entries(players).forEach(([pName, pData]) => {
          if(pName === user) {
              getEl("myScoreEl").innerText = `You: ${pData.score}`;
          } else {
              opName = pName;
              opScore = pData.score;
          }
      });
  
      getEl("opScoreEl").innerText = `${opName}: ${opScore}`;
  }
  
  function showEndScreen(winnerName) {
      const screen = getEl("endScreen");
      const title = getEl("endTitle");
      const msg = getEl("endMessage");
      const rematchBtn = getEl("btnRematch");
  
      // Prevent accidental double clicks immediately after winning
      rematchBtn.disabled = true;
      setTimeout(() => { rematchBtn.disabled = false; }, 1500);
  
      screen.classList.remove("hidden");
  
      if (winnerName === user) {
          title.innerText = "YOU WON! 🏆";
          title.className = "result-title won";
          msg.innerText = "Great memory! You finished first.";
      } else {
          title.innerText = "YOU LOST 💀";
          title.className = "result-title lost";
          msg.innerText = `${winnerName} finished before you.`;
      }
  
      if(isHost) {
          getEl("hostControls").classList.remove("hidden");
          getEl("waitControls").classList.add("hidden");
      } else {
          getEl("hostControls").classList.add("hidden");
          getEl("waitControls").classList.remove("hidden");
      }
  }
  
  // --- HOST CONTROLS ---
  function restartGame() {
      if(!isHost) return;
      
      dbRef.update({
          cards: shuffle([...icons, ...icons]), 
          state: "playing",
          winner: "",
          chat: {} 
      });
  
      dbRef.child("players").once("value", s => {
          s.forEach(p => {
              p.ref.update({ score: 0 });
          });
      });
      
      localCards = []; 
  }
  
  function closeRoom() {
      if(confirm("Close this room for everyone?")) {
          dbRef.remove();
          clearSession(); // Clear session on explicit close
          location.reload();
      }
  }
  
  // --- CHAT ---
  function renderChat(chatData) {
    const chatBox = getEl("chat");
    chatBox.innerHTML = "";
    Object.values(chatData).forEach(msg => {
      const div = document.createElement("div");
      div.className = "chat-msg";
      div.innerText = msg;
      chatBox.appendChild(div);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
  }
  
  function sendChat(e) {
    if(e.key !== "Enter" || !e.target.value.trim()) return;
    db.ref("rooms/"+roomCode+"/chat").push(`${user}: ${e.target.value}`);
    e.target.value = "";
  }
  
  function copyCode() {
      navigator.clipboard.writeText(roomCode);
      alert("Room name copied!");
  }


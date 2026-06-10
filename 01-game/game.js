const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

canvas.width = 800;
canvas.height = 400;

const state = {
  screen: 'start',
  score: 0,
  bestScore: parseInt(localStorage.getItem('neonDashBest')) || 0,
  soundEnabled: true,
  speed: 5,
  distance: 0,
  shakeAmount: 0
};

const player = {
  x: 100,
  y: 300,
  width: 30,
  height: 30,
  vy: 0,
  grounded: true,
  jumpPower: -12,
  gravity: 0.6
};

let obstacles = [];
let particles = [];
let animationId = null;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
  if (!state.soundEnabled) return;
  
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  
  if (type === 'jump') {
    osc.type = 'square';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
  } else if (type === 'score') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.05);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.05);
  } else if (type === 'die') {
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioCtx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  }
}

function spawnParticles(x, y, color, count = 10) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      life: 1,
      color,
      size: Math.random() * 4 + 2
    });
  }
}

function updateParticles() {
  particles = particles.filter(p => {
    p.x += p.vx;
    p.y += p.vy;
    p.life -= 0.03;
    return p.life > 0;
  });
}

function drawParticles() {
  particles.forEach(p => {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  });
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
}

function jump() {
  if (player.grounded) {
    player.vy = player.jumpPower;
    player.grounded = false;
    spawnParticles(player.x + player.width/2, player.y + player.height, '#0ff', 8);
    playSound('jump');
  }
}

function spawnObstacle() {
  const height = Math.random() * 60 + 40;
  obstacles.push({
    x: canvas.width,
    y: canvas.height - height,
    width: 30,
    height: height,
    passed: false
  });
}

function reset() {
  player.y = 300;
  player.vy = 0;
  player.grounded = true;
  obstacles = [];
  particles = [];
  state.score = 0;
  state.distance = 0;
  state.speed = 5;
  state.shakeAmount = 0;
  document.getElementById('score-display').textContent = '0';
}

function gameOver() {
  state.screen = 'gameover';
  state.shakeAmount = 15;
  playSound('die');
  
  const isNewBest = state.score > state.bestScore;
  if (isNewBest) {
    state.bestScore = state.score;
    localStorage.setItem('neonDashBest', state.bestScore);
  }
  
  document.getElementById('final-score').textContent = state.score;
  document.getElementById('best-display').textContent = `BEST: ${state.bestScore}`;
  document.getElementById('new-best').classList.toggle('hidden', !isNewBest);
  document.getElementById('game-over-screen').classList.remove('hidden');
  document.getElementById('game-container').classList.add('shake');
  setTimeout(() => document.getElementById('game-container').classList.remove('shake'), 300);
}

function update() {
  if (state.screen !== 'playing') return;
  
  state.distance++;
  
  if (state.distance % 300 === 0) {
    state.speed += 0.5;
  }
  
  player.vy += player.gravity;
  player.y += player.vy;
  
  if (player.y + player.height >= canvas.height) {
    player.y = canvas.height - player.height;
    player.vy = 0;
    player.grounded = true;
  }
  
  if (obstacles.length === 0 || obstacles[obstacles.length - 1].x < canvas.width - 250) {
    if (Math.random() < 0.02) spawnObstacle();
  }
  
  obstacles.forEach(obs => {
    obs.x -= state.speed;
    
    if (!obs.passed && obs.x + obs.width < player.x) {
      obs.passed = true;
      state.score++;
      document.getElementById('score-display').textContent = state.score;
      spawnParticles(obs.x + obs.width, obs.y + obs.height/2, '#f0f', 5);
      playSound('score');
    }
  });
  
  obstacles = obstacles.filter(obs => obs.x + obs.width > 0);
  
  obstacles.forEach(obs => {
    if (player.x < obs.x + obs.width &&
        player.x + player.width > obs.x &&
        player.y < obs.y + obs.height &&
        player.y + player.height > obs.y) {
      gameOver();
    }
  });
  
  updateParticles();
  
  if (state.shakeAmount > 0) state.shakeAmount *= 0.9;
}

function draw() {
  ctx.save();
  
  if (state.shakeAmount > 0.5) {
    ctx.translate(
      (Math.random() - 0.5) * state.shakeAmount,
      (Math.random() - 0.5) * state.shakeAmount
    );
  }
  
  ctx.fillStyle = '#0d0d1a';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#0d0d1a');
  gradient.addColorStop(1, '#1a0a2e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  ctx.strokeStyle = '#1a1a2a';
  ctx.lineWidth = 1;
  for (let i = 0; i < canvas.width; i += 40) {
    ctx.beginPath();
    ctx.moveTo(i - (state.distance % 40), 0);
    ctx.lineTo(i - (state.distance % 40), canvas.height);
    ctx.stroke();
  }
  
  ctx.fillStyle = '#0ff';
  ctx.shadowColor = '#0ff';
  ctx.shadowBlur = 20;
  ctx.fillRect(player.x, player.y, player.width, player.height);
  ctx.shadowBlur = 30;
  ctx.fillStyle = '#fff';
  ctx.fillRect(player.x + 5, player.y + 5, 10, 10);
  ctx.shadowBlur = 0;
  
  obstacles.forEach(obs => {
    ctx.fillStyle = '#f33';
    ctx.shadowColor = '#f33';
    ctx.shadowBlur = 15;
    ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    ctx.shadowBlur = 0;
    
    ctx.strokeStyle = '#f66';
    ctx.lineWidth = 2;
    ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
  });
  
  drawParticles();
  
  ctx.restore();
}

function loop() {
  update();
  draw();
  animationId = requestAnimationFrame(loop);
}

function startGame() {
  audioCtx.resume();
  state.screen = 'playing';
  reset();
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('game-over-screen').classList.add('hidden');
}

document.addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault();
    if (state.screen === 'playing') jump();
    else if (state.screen === 'start') startGame();
    else if (state.screen === 'gameover') startGame();
  }
});

canvas.addEventListener('click', () => {
  if (state.screen === 'playing') jump();
});

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);

document.getElementById('sound-toggle').addEventListener('click', () => {
  state.soundEnabled = !state.soundEnabled;
  document.getElementById('sound-toggle').textContent = state.soundEnabled ? '🔊' : '🔇';
});

document.getElementById('best-display').textContent = `BEST: ${state.bestScore}`;

loop();
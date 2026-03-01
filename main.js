/**
 * OBSERVER_ENGINE // COMPLETE SOURCE // VER 19.0
 * FEATURES: SEQUENTIAL BOSSES // PERSISTENT INPUT LOCK // HP BARS
 * SEQUENCE: DRILL -> FIGHT -> DRILL -> FIGHT -> DRILL -> BOSS (1-BY-1) -> FINAL DRILL -> SURFACE
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('input_video');
const pip = document.getElementById('pipCanvas'); 
const pctx = pip.getContext('2d');

let w, h;
const resize = () => {
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w; canvas.height = h;
    if(pip) { pip.width = 320; pip.height = 180; }
};
window.addEventListener('resize', resize);
resize();

// --- 1. ASSETS ---
const assets = {};
const assetFiles = {
    intro: "intro.png", startBtn: "start_btn.png", gameOver: "gameover.png",
    drill: "drill.png", rock: "obstacle.png", enemy: "enemy.png",
    bg: "background.png", stalactite: "stalactite.png", cannonball: "cannonball.png",
    coin: "coin.png", wormhead: "wormhead.png", wormbody: "wormbody.png", wormtail: "wormtail.png"
};

let dirtPattern;
function createDirtTexture() {
    const dCanvas = document.createElement('canvas');
    dCanvas.width = 128; dCanvas.height = 128;
    const dCtx = dCanvas.getContext('2d');
    dCtx.fillStyle = "#1a0f00"; dCtx.fillRect(0,0,128,128);
    for(let i=0; i<400; i++) {
        dCtx.fillStyle = Math.random() > 0.5 ? "#2a1a00" : "#120800";
        dCtx.fillRect(Math.random()*128, Math.random()*128, 2, 2);
    }
    dirtPattern = ctx.createPattern(dCanvas, 'repeat');
}

async function loadAssets() {
    const promises = Object.keys(assetFiles).map(key => {
        return new Promise((res) => {
            const img = new Image();
            img.onload = () => { assets[key] = img; res(); };
            img.onerror = () => { console.warn("Missing:", key); res(); };
            img.src = assetFiles[key];
        });
    });
    await Promise.all(promises);
    createDirtTexture();
}

// --- 2. STATE ---
const STAGES = [
    { type: "DRILLING", duration: 600 },
    { type: "COMBAT", duration: 800 },
    { type: "DRILLING", duration: 600 },
    { type: "COMBAT", duration: 1000 },
    { type: "DRILLING", duration: 600 },
    { type: "BOSS", duration: 0 }, 
    { type: "FINAL_DRILL", duration: 300 },
    { type: "SURFACE", duration: 999999 }
];

let currentState = "INTRO";
let showTutorial = false;
let currentStageIdx = 0, stageTimer = 0;
let frame = 0, hp = 100, score = 0, coins = 0, freezeTimer = 0;
let gear = { x: 400, y: 400, active: true, gesture: "IDLE", charge: 0, rawLM: null };
let obstacles = [], projectiles = [], enemies = [], collectables = [], currentWorm = [];
let wormIndex = 0; // Tracks which of the 3 worms we are on
let activeSingularity = null, singularityCooldown = 0;
const BARRIER_RADIUS = 110;

// --- 3. VISION ---
const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 0, minDetectionConfidence: 0.7 });
hands.onResults((res) => {
    if (pctx) { pctx.clearRect(0,0,320,180); pctx.drawImage(res.image, 0, 0, 320, 180); }
    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
        const lm = res.multiHandLandmarks[0];
        gear.rawLM = lm;
        gear.active = true; // Input is live
        gear.x += ((1 - lm[9].x) * w - gear.x) * 0.4;
        gear.y += (lm[9].y * h - gear.y) * 0.4;
        
        const f = [
            Math.hypot(lm[8].x - lm[0].x, lm[8].y - lm[0].y) > Math.hypot(lm[6].x - lm[0].x, lm[6].y - lm[0].y) * 1.2,
            Math.hypot(lm[12].x - lm[0].x, lm[12].y - lm[0].y) > Math.hypot(lm[10].x - lm[0].x, lm[10].y - lm[0].y) * 1.2,
            Math.hypot(lm[16].x - lm[0].x, lm[16].y - lm[0].y) > Math.hypot(lm[14].x - lm[0].x, lm[14].y - lm[0].y) * 1.2,
            Math.hypot(lm[20].x - lm[0].x, lm[20].y - lm[0].y) > Math.hypot(lm[18].x - lm[0].x, lm[18].y - lm[0].y) * 1.2
        ];
        const pinch = Math.hypot(lm[4].x - lm[8].x, lm[4].y - lm[8].y);
        
        let g = "IDLE";
        if (pinch < 0.05 && f[1] && f[2] && f[3]) g = "SINGULARITY";
        else if (f[0] && f[3] && !f[1] && !f[2]) g = "FREEZE";
        else if (f[0] && f[1] && f[2] && f[3]) g = (gear.charge > 30) ? "FIRE_CANNON" : "OPEN";
        else if (!f[0] && !f[1] && !f[2] && !f[3]) g = "CHARGE";
        else if (f[0] && f[1] && !f[2] && !f[3]) g = "PEACE";
        else if (f[0] && !f[1] && !f[2] && !f[3]) g = "SINGLE";
        gear.gesture = g;

        if (g === "SINGULARITY" && !activeSingularity && singularityCooldown <= 0) { activeSingularity = { x: gear.x, y: gear.y, timer: 300 }; singularityCooldown = 600; }
        if (g === "FREEZE" && freezeTimer <= 0) freezeTimer = 200;
    } 
    // If no hand, gear.active stays true, keeping x/y locked at last position.
});

// --- 4. RENDERERS ---
function drawTutorial() {
    ctx.fillStyle = "rgba(0, 5, 20, 0.98)"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#0ff"; ctx.lineWidth = 3; ctx.strokeRect(w/2-350, h/2-280, 700, 560);
    ctx.fillStyle = "#fff"; ctx.font = "bold 32px Orbitron"; ctx.textAlign = "center";
    ctx.fillText("OPERATIONAL GUIDELINES", w/2, h/2 - 220);
    const rows = [
        ["PHASE", "GESTURE", "ACTION"],
        ["DRILLING", "MOVE HAND", "MINE COINS / DODGE ROCKS"],
        ["COMBAT", "INDEX UP", "FIRE STALACTITE"],
        ["COMBAT", "PEACE SIGN", "DOUBLE STALACTITE"],
        ["COMBAT", "FIST", "CHARGE CANNONBALL"],
        ["COMBAT", "OPEN HAND", "FIRE CANNONBALL"],
        ["COMBAT", "SPIDERMAN", "FREEZE ENEMIES"],
        ["COMBAT", "PINCH+3F", "SINGULARITY"]
    ];
    ctx.font = "16px Orbitron"; ctx.textAlign = "left";
    rows.forEach((r, i) => {
        let y = h/2 - 140 + (i * 45);
        ctx.fillStyle = i === 0 ? "#0ff" : "#fff";
        ctx.fillText(r[0], w/2 - 300, y);
        ctx.fillText(r[1], w/2 - 140, y);
        ctx.fillText(r[2], w/2 + 70, y);
        ctx.fillStyle = "rgba(0,255,255,0.1)"; ctx.fillRect(w/2-310, y+10, 620, 1);
    });
    ctx.fillStyle = "#0ff"; ctx.textAlign = "center"; ctx.font = "bold 22px Orbitron";
    ctx.fillText("CLICK TO BEGIN MISSION", w/2, h/2 + 240);
}

function drawUI() {
    if (currentState === "SURFACE" || currentState === "INTRO" || showTutorial) return;
    ctx.fillStyle = "rgba(0, 5, 15, 0.9)"; ctx.fillRect(50, 20, 240, 90);
    ctx.strokeStyle = "#0ff"; ctx.strokeRect(50, 20, 240, 90);
    ctx.textAlign="center"; ctx.fillStyle="white"; ctx.font="bold 20px Orbitron";
    ctx.fillText(score.toString().padStart(6, '0'), 170, 55);
    ctx.fillStyle="#ffd700"; ctx.fillText(`COINS: ${coins}`, 170, 80);
    ctx.fillStyle="#222"; ctx.fillRect(w/2-150, 30, 300, 15);
    ctx.fillStyle=`hsl(${(hp/100)*120}, 100%, 50%)`; ctx.fillRect(w/2-150, 30, (Math.max(0, hp)/100)*300, 15);
}

function drawHandSkeleton() {
    if (!gear.rawLM) return;
    ctx.beginPath(); ctx.arc(gear.x, gear.y, BARRIER_RADIUS, 0, Math.PI*2);
    ctx.strokeStyle = "rgba(0, 255, 255, 0.4)"; ctx.lineWidth = 3; ctx.stroke();
    ctx.save(); ctx.translate(gear.x, gear.y); ctx.scale(0.3, 0.3);
    ctx.strokeStyle = (freezeTimer > 0) ? "#0ff" : "white"; ctx.lineWidth = 14;
    [[0,1,2,3,4],[0,5,6,7,8],[0,9,10,11,12],[0,13,14,15,16],[0,17,18,19,20],[5,9,13,17,0]].forEach(c => {
        ctx.beginPath(); c.forEach((idx, ii) => {
            const rx = (gear.rawLM[9].x - gear.rawLM[idx].x) * w, ry = (gear.rawLM[idx].y - gear.rawLM[9].y) * h;
            if (ii === 0) ctx.moveTo(rx, ry); else ctx.lineTo(rx, ry);
        });
        ctx.stroke();
    });
    ctx.restore();
}

function drawDrilling() {
    stageTimer++;
    if (stageTimer > STAGES[currentStageIdx].duration) {
        currentStageIdx++; stageTimer=0; currentState = STAGES[currentStageIdx].type;
        if (currentState === "BOSS") { wormIndex = 0; spawnNextWorm(); }
        obstacles = []; collectables = []; return;
    }
    ctx.save(); ctx.translate(0, (frame * 15) % 128); ctx.fillStyle = dirtPattern; ctx.fillRect(0, -128, w, h + 256); ctx.restore();
    if (frame % 40 === 0) obstacles.push({ x: Math.random()*w, y: -200 });
    if (frame % 50 === 0) collectables.push({ x: Math.random()*w, y: -100 });
    obstacles.forEach((o, i) => {
        o.y += 18; if (assets.rock) ctx.drawImage(assets.rock, o.x-80, o.y-80, 160, 160);
        if (Math.hypot(gear.x - o.x, (h*0.7) - o.y) < 85) { hp -= 8; obstacles.splice(i,1); }
    });
    collectables.forEach((c, i) => {
        c.y += 12; if (assets.coin) ctx.drawImage(assets.coin, c.x-30, c.y-30, 60, 60);
        if (Math.hypot(gear.x - c.x, (h*0.7) - c.y) < 70) { coins++; score += 200; collectables.splice(i,1); }
    });
    if (assets.drill) ctx.drawImage(assets.drill, gear.x-60, h*0.7-100, 120, 200);
}

function spawnNextWorm() {
    currentWorm = [];
    for(let i=0; i<12; i++) {
        currentWorm.push({ 
            x: -200 - (i*40), y: h/2, 
            hp: 250, maxHp: 250, 
            type: i===0?"head":(i===11?"tail":"body") 
        });
    }
}

function drawCombat(isBoss = false) {
    if (assets.bg) ctx.drawImage(assets.bg, 0, 0, w, h);
    if (freezeTimer > 0) freezeTimer--;
    if (singularityCooldown > 0) singularityCooldown--;
    
    // Projectiles
    if (gear.rawLM) {
        const lm = gear.rawLM;
        const iTip = { x: (1-lm[8].x)*w, y: lm[8].y*h };
        const dx = iTip.x - ((1-lm[5].x)*w), dy = iTip.y - (lm[5].y*h), dist = Math.hypot(dx,dy)||1;
        const iVec = { x: dx/dist, y: dy/dist, angle: Math.atan2(dy,dx) };
        if (gear.gesture === "SINGLE" && frame % 8 === 0) projectiles.push({x: iTip.x, y: iTip.y, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
        if (gear.gesture === "PEACE" && frame % 10 === 0) {
            projectiles.push({x: iTip.x, y: iTip.y, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
            projectiles.push({x: (1-lm[12].x)*w, y: lm[12].y*h, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
        }
        if (gear.gesture === "CHARGE") gear.charge = Math.min(400, gear.charge + 15);
        if (gear.gesture === "FIRE_CANNON") { projectiles.push({x: gear.x, y: gear.y, vx: iVec.x*22, vy: iVec.y*22, type: "CANNON", size: 65+gear.charge/4}); gear.charge = 0; }
    }

    projectiles.forEach((p, i) => { p.x += p.vx; p.y += p.vy; ctx.save(); ctx.translate(p.x, p.y); if (p.type === "STALACTITE" && assets.stalactite) { ctx.rotate(p.angle+Math.PI/2); ctx.drawImage(assets.stalactite, -20, -40, 40, 80); } else if (assets.cannonball) ctx.drawImage(assets.cannonball, -p.size/2, -p.size/2, p.size, p.size); ctx.restore(); });

    if (isBoss) {
        // Spawn minions only during the final worm
        if (wormIndex === 2 && frame % 60 === 0 && enemies.length < 4) {
            enemies.push({ x: Math.random()*w, y: -100, hp: 12, max: 12 });
        }

        // Handle Current Worm
        if (currentWorm.length > 0) {
            currentWorm.forEach((s, i) => {
                const tx = i === 0 ? gear.x : currentWorm[i-1].x; const ty = i === 0 ? gear.y : currentWorm[i-1].y;
                const angle = Math.atan2(ty - s.y, tx - s.x);
                if (freezeTimer <= 0) {
                    if (i === 0) { s.x += Math.cos(angle)*2.5; s.y += Math.sin(angle)*2.5; } // SLOWER SPEED
                    else { const d = Math.hypot(tx-s.x, ty-s.y); if(d>35){ s.x += Math.cos(angle)*(d-35); s.y += Math.sin(angle)*(d-35); } }
                }
                ctx.save(); ctx.translate(s.x, s.y); if(s.type==="body") ctx.scale(1, Math.sin(frame*0.1+i)*0.3+1);
                ctx.rotate(angle); let img = s.type==="head"?assets.wormhead:(s.type==="tail"?assets.wormtail:assets.wormbody);
                if(img) ctx.drawImage(img, -45, -45, 90, 90); ctx.restore();
                
                // Segment Health Bar
                ctx.fillStyle="black"; ctx.fillRect(s.x-25, s.y-55, 50, 6); ctx.fillStyle="red"; ctx.fillRect(s.x-25, s.y-55, (s.hp/s.maxHp)*50, 6);

                projectiles.forEach((p, pi) => {
                    if (Math.hypot(p.x-s.x, p.y-s.y) < 50) { 
                        s.hp -= (p.type==="CANNON"?25:5); 
                        if(p.type!=="CANNON") projectiles.splice(pi,1); 
                        if(s.hp<=0) currentWorm.splice(i,1); 
                    }
                });
                if(Math.hypot(gear.x-s.x, gear.y-s.y)<70) hp-=0.2;
            });
        } else {
            // Worm died, check for next
            wormIndex++;
            if (wormIndex < 3) spawnNextWorm();
            else { currentStageIdx++; currentState = "FINAL_DRILL"; stageTimer = 0; enemies = []; }
        }

        // Process minion combat during boss
        enemies.forEach((e, i) => {
            let d = Math.hypot(gear.x-e.x, gear.y-e.y);
            if(freezeTimer<=0){ e.x += (gear.x-e.x)/d*4; e.y += (gear.y-e.y)/d*4+1; }
            if(assets.enemy) ctx.drawImage(assets.enemy, e.x-30, e.y-30, 60, 60);
            projectiles.forEach((p, pi) => { if(Math.hypot(p.x-e.x, p.y-e.y)<50){ e.hp -= (p.type==="CANNON"?20:6); if(p.type!=="CANNON") projectiles.splice(pi,1); if(e.hp<=0) enemies.splice(i,1); } });
            if(d < 70) hp -= 0.1;
        });

    } else {
        stageTimer++;
        if (stageTimer > STAGES[currentStageIdx].duration) { currentStageIdx++; stageTimer=0; currentState = STAGES[currentStageIdx].type; enemies=[]; projectiles=[]; }
        if (frame % 45 === 0 && freezeTimer <= 0) enemies.push({ x: Math.random()*w, y: -100, hp: 12, max: 12 });
        enemies.forEach((e, i) => {
            let d = Math.hypot(gear.x-e.x, gear.y-e.y);
            if(freezeTimer<=0){ e.x += (gear.x-e.x)/d*4; e.y += (gear.y-e.y)/d*4+1; }
            if(assets.enemy) ctx.drawImage(assets.enemy, e.x-30, e.y-30, 60, 60);
            ctx.fillStyle="black"; ctx.fillRect(e.x-20, e.y-40, 40, 5); ctx.fillStyle="#0f0"; ctx.fillRect(e.x-20, e.y-40, (e.hp/e.max)*40, 5);
            projectiles.forEach((p, pi) => { if(Math.hypot(p.x-e.x, p.y-e.y)<50){ e.hp -= (p.type==="CANNON"?20:6); if(p.type!=="CANNON") projectiles.splice(pi,1); if(e.hp<=0){ enemies.splice(i,1); score+=300; } } });
            if(d < 70) hp -= 0.2;
        });
    }
}

function drawSurface() {
    ctx.fillStyle = "#87CEEB"; ctx.fillRect(0,0,w,h); 
    ctx.fillStyle = "#228B22"; ctx.fillRect(0, h*0.7, w, h*0.3); 
    ctx.fillStyle = "yellow"; ctx.beginPath(); ctx.arc(w-100, 100, 50, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "white"; ctx.textAlign="center"; ctx.font="bold 40px Orbitron";
    ctx.fillText("MISSION COMPLETE: THE SURFACE", w/2, h/2);
    ctx.font="24px Orbitron"; ctx.fillText(`SCORE: ${score} | COINS: ${coins}`, w/2, h/2+60);
    ctx.fillStyle="#0ff"; ctx.fillText("CLICK TO REBOOT SYSTEM", w/2, h/2+120);
}

// --- 5. SYSTEM LOOP ---
async function startSystem() {
    await loadAssets();
    const camera = new Camera(video, { onFrame: async () => { await hands.send({image: video}); }, width: 640, height: 480 });
    camera.start();
    requestAnimationFrame(function loop() {
        if (!showTutorial) frame++; 
        ctx.clearRect(0,0,w,h);
        if (hp <= 0 && currentState !== "GAMEOVER") currentState = "GAMEOVER";
        if (currentState === "INTRO") {
            if(assets.intro) ctx.drawImage(assets.intro, 0, 0, w, h);
            if(assets.startBtn) ctx.drawImage(assets.startBtn, w/2-150, h*0.7, 300, 100);
        } else if (showTutorial) {
            drawTutorial();
        } else if (currentState === "DRILLING" || currentState === "FINAL_DRILL") {
            drawDrilling(); drawUI();
        } else if (currentState === "COMBAT") {
            drawCombat(false); drawUI(); drawHandSkeleton();
        } else if (currentState === "BOSS") {
            drawCombat(true); drawUI(); drawHandSkeleton();
        } else if (currentState === "SURFACE") {
            drawSurface();
        } else if (currentState === "GAMEOVER") {
            if(assets.gameOver) ctx.drawImage(assets.gameOver, 0, 0, w, h);
            ctx.fillStyle="white"; ctx.font="30px Orbitron"; ctx.textAlign="center";
            ctx.fillText(`SCORE: ${score} | COINS: ${coins}`, w/2, h/2+80);
        }
        requestAnimationFrame(loop);
    });
}

canvas.addEventListener('mousedown', () => {
    if (currentState === "INTRO") { hp=100; score=0; coins=0; currentStageIdx=0; currentState="DRILLING"; showTutorial=true; }
    else if (showTutorial) showTutorial = false;
    else if (currentState === "GAMEOVER" || currentState === "SURFACE") { currentState="INTRO"; currentStageIdx=0; }
});
startSystem();
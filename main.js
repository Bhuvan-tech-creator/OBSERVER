
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('input_video');
const pip = document.getElementById('pipCanvas'); 
const pctx = pip ? pip.getContext('2d') : null;

const introVid = document.createElement('video');
introVid.src = 'introvid.mp4';
introVid.style.display = 'none';

let w, h;
const resize = () => {
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w; canvas.height = h;
    if(pip) { pip.width = 320; pip.height = 180; }
};
window.addEventListener('resize', resize);
resize();

const assets = {};
const assetFiles = {
    intro: "intro.png", startBtn: "start_btn.png", gameOver: "gameover.png",
    drill: "drill.png", rock: "obstacle.png", enemy: "enemy.png",
    bg: "background.png", stalactite: "stalactite.png", cannonball: "cannonball.png",
    coin: "coin.png", wormhead: "wormhead.png", wormbody: "wormbody.png", wormtail: "wormtail.png",
    win: "win.png"
};

const sfx = {
    cave: new Audio('cave.mp3'),
    drill: new Audio('drill.wav'),
    kill: new Audio('kill.wav'),
    shoot: new Audio('shoot.wav'),
    boss: new Audio('whenuseetheboss.wav'),
    win: new Audio('win.mp3'),
    death: new Audio('death.wav'),
    coin: new Audio('coin.wav')
};

sfx.cave.loop = true;
sfx.drill.loop = true;

function stopAllAudio() {
    Object.values(sfx).forEach(a => {
        a.pause();
        a.currentTime = 0;
    });
}

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
            img.onerror = () => { res(); };
            img.src = assetFiles[key];
        });
    });
    await Promise.all(promises);
    createDirtTexture();
}


const STAGES = [
    { type: "DRILLING", duration: 720, label: "MINE 1", goal: 0 },
    { type: "COMBAT", duration: 0, label: "KILL 30", goal: 30 },
    { type: "DRILLING", duration: 720, label: "MINE 2", goal: 0 },
    { type: "COMBAT", duration: 0, label: "KILL 50", goal: 50 },
    { type: "DRILLING", duration: 720, label: "MINE 3", goal: 0 },
    { type: "BOSS", duration: 0, label: "BOSS", goal: 0 },
    { type: "FINAL_DRILL", duration: 720, label: "EXIT", goal: 0 },
    { type: "SURFACE", duration: 0, label: "END", goal: 0 }
];

const totalGameTicks = STAGES.reduce((acc, s) => acc + (s.duration || 1000), 0);
let totalElapsedTicks = 0;

let currentState = "INTRO";
let showTutorial = false;
let currentStageIdx = 0, stageTimer = 0, killCount = 0;
let frame = 0, hp = 100, score = 0, coins = 0, freezeTimer = 0;
let gear = { x: 400, y: 400, active: false, gesture: "IDLE", charge: 0, rawLM: null };
let obstacles = [], projectiles = [], enemies = [], collectables = [], currentWorm = [];
let wormIndex = 0;
let activeSingularity = null, singularityCooldown = 0;
const BARRIER_RADIUS = 110;


const hands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}` });
hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });

hands.onResults((res) => {
    if (pctx) { pctx.clearRect(0,0,320,180); pctx.drawImage(res.image, 0, 0, 320, 180); }
    if (res.multiHandLandmarks && res.multiHandLandmarks.length > 0) {
        const lm = res.multiHandLandmarks[0];
        gear.rawLM = lm;
        gear.active = true;
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
    } else { gear.active = false; }
});


function drawProgressTracker() {
    const barX = 30, barY = 150, barW = 20, barH = h - 300;
    ctx.fillStyle = "rgba(0, 255, 255, 0.1)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = "#0ff";
    ctx.strokeRect(barX, barY, barW, barH);
    let progress = Math.min(1, totalElapsedTicks / totalGameTicks);
    ctx.fillStyle = "#0ff";
    ctx.fillRect(barX, barY + barH, barW, -barH * progress);
    let currentTicks = 0;
    STAGES.forEach((stage, idx) => {
        let markY = barY + barH - (barH * (currentTicks / totalGameTicks));
        ctx.beginPath(); ctx.moveTo(barX, markY); ctx.lineTo(barX + barW + 10, markY);
        ctx.strokeStyle = idx <= currentStageIdx ? "#0ff" : "#555"; ctx.stroke();
        ctx.font = "10px Orbitron"; ctx.fillStyle = idx <= currentStageIdx ? "#0ff" : "#555";
        ctx.textAlign = "left"; 
        let label = stage.label;
        if (idx === currentStageIdx && stage.goal > 0) label += ` (${killCount}/${stage.goal})`;
        ctx.fillText(label, barX + barW + 15, markY + 4);
        currentTicks += (stage.duration || 1000);
    });
}

function drawUI() {
    if (currentState === "SURFACE" || currentState === "INTRO" || currentState === "VIDEO_TRANSITION" || showTutorial) return;
    ctx.fillStyle = "rgba(0, 5, 15, 0.9)"; ctx.fillRect(50, 20, 240, 110);
    ctx.strokeStyle = "#0ff"; ctx.strokeRect(50, 20, 240, 110);
    ctx.textAlign="center"; ctx.fillStyle="white"; ctx.font="bold 20px Orbitron";
    ctx.fillText(score.toString().padStart(6, '0'), 170, 50);
    ctx.fillStyle="#ffd700"; ctx.fillText(`COINS: ${coins}`, 170, 75);
    
    if (STAGES[currentStageIdx].goal > 0) {
        ctx.fillStyle="#0ff"; ctx.font="14px Orbitron";
        ctx.fillText(`KILLS: ${killCount} / ${STAGES[currentStageIdx].goal}`, 170, 105);
    }

    ctx.fillStyle="#222"; ctx.fillRect(w/2-150, 30, 300, 15);
    ctx.fillStyle=`hsl(${(hp/100)*120}, 100%, 50%)`; ctx.fillRect(w/2-150, 30, (Math.max(0, hp)/100)*300, 15);
    drawProgressTracker();
}

function drawHandSkeleton() {
    if (!gear.rawLM || !gear.active) return;
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
    stageTimer++; totalElapsedTicks++;
    if (sfx.drill.paused) sfx.drill.play();
    if (stageTimer > STAGES[currentStageIdx].duration) {
        currentStageIdx++; stageTimer=0; killCount=0;
        currentState = STAGES[currentStageIdx].type;
        sfx.drill.pause();
        if (currentState === "BOSS") { wormIndex = 0; spawnNextWorm(); }
        obstacles = []; collectables = []; return;
    }
    ctx.save(); ctx.translate(0, (frame * 15) % 128); ctx.fillStyle = dirtPattern; ctx.fillRect(0, -128, w, h + 256); ctx.restore();
    
    // ROCKS: 1 every 90 frames
    if (frame % 90 === 0) obstacles.push({ x: Math.random()*(w-200)+100, y: -100 });
    
    if (frame % 35 === 0) collectables.push({ x: Math.random()*(w-200)+100, y: -50 });
    obstacles.forEach((o, i) => {
        o.y += 15; if (assets.rock) ctx.drawImage(assets.rock, o.x-80, o.y-80, 160, 160);
        if (Math.hypot(gear.x - o.x, (h*0.7) - o.y) < 90) { hp -= 8; obstacles.splice(i,1); }
        if (o.y > h + 100) obstacles.splice(i, 1);
    });
    collectables.forEach((c, i) => {
        c.y += 10; 
        if (assets.coin) {
            ctx.save(); ctx.shadowColor = "#fff700"; ctx.shadowBlur = 15 + Math.sin(frame * 0.2) * 8;
            ctx.drawImage(assets.coin, c.x-40, c.y-40, 80, 80); ctx.restore();
        }
        if (Math.hypot(gear.x - c.x, (h*0.7) - c.y) < 100) { 
            coins++; score += 200; sfx.coin.cloneNode().play(); collectables.splice(i,1); 
        }
        if (c.y > h + 100) collectables.splice(i, 1);
    });
    if (assets.drill) ctx.drawImage(assets.drill, gear.x-60, h*0.7-100, 120, 200);
}

function spawnNextWorm() {
    currentWorm = []; 
    sfx.boss.play();
    let speed = (wormIndex === 0) ? 3.5 : 5.3;
    let length = (wormIndex === 2) ? 14 : 12;

    for(let i=0; i<length; i++) {
        currentWorm.push({ 
            x: -200 - (i*40), 
            y: h/2, 
            hp: 900, 
            maxHp: 900, 
            speed: speed,
            type: i===0 ? "head" : (i===length-1 ? "tail" : "body") 
        });
    }
}

function drawCombat(isBoss = false) {
    if (assets.bg) ctx.drawImage(assets.bg, 0, 0, w, h);
    if (sfx.cave.paused) sfx.cave.play();
    if (freezeTimer > 0) freezeTimer--;
    if (singularityCooldown > 0) singularityCooldown--;
    totalElapsedTicks++;

    if (gear.rawLM && gear.active) {
        const lm = gear.rawLM;
        const iTip = { x: (1-lm[8].x)*w, y: lm[8].y*h };
        const dx = iTip.x - ((1-lm[5].x)*w), dy = iTip.y - (lm[5].y*h), dist = Math.hypot(dx,dy)||1;
        const iVec = { x: dx/dist, y: dy/dist, angle: Math.atan2(dy,dx) };
        if (gear.gesture === "SINGLE" && frame % 8 === 0) {
            projectiles.push({x: iTip.x, y: iTip.y, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
            sfx.shoot.cloneNode().play();
        }
        if (gear.gesture === "PEACE" && frame % 10 === 0) {
            projectiles.push({x: iTip.x, y: iTip.y, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
            projectiles.push({x: (1-lm[12].x)*w, y: lm[12].y*h, vx: iVec.x*35, vy: iVec.y*35, type: "STALACTITE", angle: iVec.angle});
            sfx.shoot.cloneNode().play();
        }
        if (gear.gesture === "CHARGE") gear.charge = Math.min(400, gear.charge + 15);
        if (gear.gesture === "FIRE_CANNON") { 
            projectiles.push({x: gear.x, y: gear.y, vx: iVec.x*22, vy: iVec.y*22, type: "CANNON", size: 65+gear.charge/4}); 
            sfx.shoot.cloneNode().play(); gear.charge = 0; 
        }
    }

    projectiles.forEach((p, i) => { 
        p.x += p.vx; p.y += p.vy; 
        ctx.save(); ctx.translate(p.x, p.y); 
        if (p.type === "STALACTITE" && assets.stalactite) { ctx.rotate(p.angle+Math.PI/2); ctx.drawImage(assets.stalactite, -20, -40, 40, 80); } 
        else if (assets.cannonball) ctx.drawImage(assets.cannonball, -p.size/2, -p.size/2, p.size, p.size); 
        ctx.restore();
        if(p.x < -200 || p.x > w+200 || p.y < -200 || p.y > h+200) projectiles.splice(i,1);
    });

    if (isBoss) {
        if (wormIndex === 2 && currentWorm.length > 0 && frame % 30 === 0) {
            enemies.push({ x: Math.random()*w, y: -100, hp: 15, max: 15 });
        }
        if (currentWorm.length > 0 || enemies.length > 0) {
            currentWorm.forEach((s, i) => {
                const tx = i === 0 ? gear.x : currentWorm[i-1].x;
                const ty = i === 0 ? gear.y : currentWorm[i-1].y;
                const angle = Math.atan2(ty - s.y, tx - s.x);
                if (freezeTimer <= 0) {
                    if (i === 0) { s.x += Math.cos(angle)*s.speed; s.y += Math.sin(angle)*s.speed; } 
                    else { const d = Math.hypot(tx-s.x, ty-s.y); if(d>35){ s.x += Math.cos(angle)*(d-35); s.y += Math.sin(angle)*(d-35); } }
                }
                ctx.save(); ctx.translate(s.x, s.y); if(s.type==="body") ctx.scale(1, Math.sin(frame*0.1+i)*0.3+1);
                ctx.rotate(angle); let img = s.type==="head"?assets.wormhead:(s.type==="tail"?assets.wormtail:assets.wormbody);
                if(img) ctx.drawImage(img, -45, -45, 90, 90); ctx.restore();
                ctx.fillStyle="black"; ctx.fillRect(s.x-25, s.y-55, 50, 6); ctx.fillStyle="red"; ctx.fillRect(s.x-25, s.y-55, (s.hp/s.maxHp)*50, 6);
                projectiles.forEach((p, pi) => {
                    if (Math.hypot(p.x-s.x, p.y-s.y) < 55) { 
                        s.hp -= (p.type==="CANNON" ? 30 : 8); 
                        if(p.type!=="CANNON") projectiles.splice(pi,1); 
                        if(s.hp<=0) { sfx.kill.cloneNode().play(); currentWorm.splice(i,1); score += 500; }
                    }
                });
                if(Math.hypot(gear.x-s.x, gear.y-s.y)<70) hp-=0.25;
            });
            enemies.forEach((e, i) => {
                let d = Math.hypot(gear.x-e.x, gear.y-e.y);
                if(freezeTimer<=0){ e.x += (gear.x-e.x)/d*4.5; e.y += (gear.y-e.y)/d*4.5; }
                if(assets.enemy) ctx.drawImage(assets.enemy, e.x-30, e.y-30, 60, 60);
                projectiles.forEach((p, pi) => { 
                    if(Math.hypot(p.x-e.x, p.y-e.y)<50){ 
                        e.hp -= (p.type==="CANNON" ? 30 : 6); 
                        if(p.type!=="CANNON") projectiles.splice(pi,1); 
                        if(e.hp<=0){ sfx.kill.cloneNode().play(); enemies.splice(i,1); score+=300; } 
                    } 
                });
                if(d < 70) hp -= 0.3;
            });
        } else {
            wormIndex++; 
            if (wormIndex < 3) spawnNextWorm();
            else { currentStageIdx++; currentState = "FINAL_DRILL"; stageTimer = 0; enemies = []; projectiles = []; sfx.cave.pause(); }
        }
    } else {
        let stageGoal = STAGES[currentStageIdx].goal;
        
        // ENEMIES: 1 every 0.9s (54 frames)
        if (frame % 54 === 0 && (killCount + enemies.length) < stageGoal) {
            enemies.push({ x: Math.random()*w, y: -100, hp: 12, max: 12 });
        }
        
        enemies.forEach((e, i) => {
            let d = Math.hypot(gear.x-e.x, gear.y-e.y);
            if(freezeTimer<=0){ e.x += (gear.x-e.x)/d*4.2; e.y += (gear.y-e.y)/d*4.2; }
            if(assets.enemy) ctx.drawImage(assets.enemy, e.x-30, e.y-30, 60, 60);
            projectiles.forEach((p, pi) => { 
                if(Math.hypot(p.x-e.x, p.y-e.y)<50){ 
                    e.hp -= (p.type==="CANNON" ? 30 : 6); 
                    if(p.type!=="CANNON") projectiles.splice(pi,1); 
                    if(e.hp<=0){ sfx.kill.cloneNode().play(); enemies.splice(i,1); score+=300; killCount++; } 
                } 
            });
            if(d < 70) hp -= 0.25;
        });
        if (killCount >= stageGoal && enemies.length === 0) {
            currentStageIdx++; stageTimer=0; killCount=0;
            currentState = STAGES[currentStageIdx].type;
            enemies=[]; projectiles=[]; sfx.cave.pause();
        }
    }
}

function drawVideoTransition() {
    ctx.drawImage(introVid, 0, 0, w, h);
    if (introVid.ended) { currentState = "DRILLING"; introVid.pause(); }
}


function drawSurface() {
    if (sfx.win.paused) sfx.win.play();
    if(assets.win) ctx.drawImage(assets.win, 0, 0, w, h);
    
    const panelW = 600, panelH = 200;
    const px = w/2 - panelW/2, py = h/2 - panelH/2;
    
    
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(px, py, panelW, panelH);
    
    
    ctx.strokeStyle = "#0ff";
    ctx.lineWidth = 5;
    ctx.strokeRect(px, py, panelW, panelH);
    
    
    ctx.textAlign = "center"; 
    ctx.fillStyle = "black"; 
    ctx.font = "bold 42px Orbitron"; 
    
    ctx.fillStyle = "white";
    ctx.fillRect(px + 20, py + 40, panelW - 40, 60);
    ctx.fillStyle = "black";
    ctx.fillText(`MISSION SCORE: ${score.toString().padStart(6, '0')}`, w/2, py + 85);
    
    
    ctx.fillStyle = "#0ff";
    ctx.fillRect(px + 20, py + 120, panelW - 40, 50);
    ctx.fillStyle = "black";
    ctx.font = "bold 26px Orbitron";
    ctx.fillText("CLICK TO RESTART", w/2, py + 155);
}


async function startSystem() {
    await loadAssets();
    const camera = new Camera(video, { onFrame: async () => { await hands.send({image: video}); }, width: 640, height: 480 });
    camera.start();

    function loop() {
        if (!showTutorial && currentState !== "VIDEO_TRANSITION") frame++; 
        ctx.clearRect(0,0,w,h);
        if (hp <= 0 && currentState !== "GAMEOVER") { currentState = "GAMEOVER"; stopAllAudio(); sfx.death.play(); }

        switch(currentState) {
            case "INTRO":
                if(assets.intro) ctx.drawImage(assets.intro, 0, 0, w, h);
                if(assets.startBtn) ctx.drawImage(assets.startBtn, w/2-150, h*0.7, 300, 100);
                break;
            case "VIDEO_TRANSITION":
                drawVideoTransition();
                break;
            case "DRILLING":
            case "FINAL_DRILL":
                drawDrilling(); drawUI();
                break;
            case "COMBAT":
                drawCombat(false); drawUI(); drawHandSkeleton();
                break;
            case "BOSS":
                drawCombat(true); drawUI(); drawHandSkeleton();
                break;
            case "SURFACE":
                drawSurface();
                break;
            case "GAMEOVER":
                if(assets.gameOver) ctx.drawImage(assets.gameOver, 0, 0, w, h);
                ctx.fillStyle="white"; ctx.font="30px Orbitron"; ctx.textAlign="center";
                ctx.fillText(`SCORE: ${score} | COINS: ${coins}`, w/2, h/2+80);
                break;
        }
        if (showTutorial) {
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
            ];
            ctx.font = "16px Orbitron"; ctx.textAlign = "left";
            rows.forEach((r, i) => {
                let y = h/2 - 140 + (i * 45);
                ctx.fillStyle = i === 0 ? "#0ff" : "#fff"; ctx.fillText(r[0], w/2 - 300, y);
                ctx.fillText(r[1], w/2 - 140, y); ctx.fillText(r[2], w/2 + 70, y);
            });
            ctx.fillStyle = "#0ff"; ctx.textAlign = "center"; ctx.font = "bold 22px Orbitron";
            ctx.fillText("CLICK TO BEGIN MISSION", w/2, h/2 + 240);
        }
        requestAnimationFrame(loop);
    }
    loop();
}

canvas.addEventListener('mousedown', () => {
    if (currentState === "INTRO") { 
        hp=100; score=0; coins=0; currentStageIdx=0; currentState="DRILLING"; showTutorial=true; totalElapsedTicks = 0; stopAllAudio();
    } else if (showTutorial) {
        showTutorial = false; currentState = "VIDEO_TRANSITION"; stopAllAudio();
        introVid.currentTime = 0;
        introVid.play().catch(e => { currentState = "DRILLING"; });
    } else if (currentState === "GAMEOVER" || currentState === "SURFACE") { 
        currentState="INTRO"; currentStageIdx=0; stopAllAudio();
    } else if (currentState === "VIDEO_TRANSITION") {
        introVid.pause(); currentState = "DRILLING";
    }
});

startSystem();
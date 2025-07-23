const MAP = [
    "##########",
    "#........#",
    "#..##....#",
    "#........#",
    "#....##..#",
    "#........#",
    "##########"
];
const MAP_WIDTH = MAP[0].length;
const MAP_HEIGHT = MAP.length;
const TILE_SIZE = 1; // logical tile size, for math

const FOV = Math.PI / 3; // 60 deg
const NUM_RAYS = 160; // columns
const VIEW_DIST = 8;

const DEMON_BODY_COLOR = "#c03";
const DEMON_HORN_COLOR = "#eee";
const DEMON_EYE_COLOR = "#fff";
const DEMON_PUPIL_COLOR = "#f00";
const DEMON_MOUTH_COLOR = "#400";
const DEMON_TOOTH_COLOR = "#fff";
const DEMON_ARM_COLOR = "#a01";

const ENEMY_IMAGE_SRC = "https://dcnmwoxzefwqmvvkpqap.supabase.co/storage/v1/object/public/sprite-studio-exports/6f1edf47-be71-4c38-9203-26202e227b0a/library/goon_1753245992352.png";
const ENEMY_IMAGE = new window.Image();
ENEMY_IMAGE.src = ENEMY_IMAGE_SRC;
let ENEMY_IMAGE_LOADED = false;
ENEMY_IMAGE.onload = () => { ENEMY_IMAGE_LOADED = true; };

class Bullet {
    constructor(x, y, dir) {
        this.x = x;
        this.y = y;
        this.dir = dir;
        this.speed = 13.0;
        this.radius = 0.06;
        this.life = 0.4; // seconds before disappearing (range)
        this.active = true;
        this.hitMonster = null;
    }

    update(game, dt) {
        if (!this.active) return;
        let dx = Math.cos(this.dir) * this.speed * dt;
        let dy = Math.sin(this.dir) * this.speed * dt;
        this.x += dx;
        this.y += dy;
        this.life -= dt;

        if (game.isWall(this.x, this.y)) {
            this.active = false;
        }

        if (this.active) {
            for (let monster of game.monsters) {
                if (!monster.isAlive) continue;
                let dist2 = (this.x - monster.x) ** 2 + (this.y - monster.y) ** 2;
                let radSum = this.radius + monster.radius;
                if (dist2 < radSum * radSum) {
                    monster.takeDamage(20);
                    this.active = false;
                    this.hitMonster = monster;
                    break;
                }
            }
        }

        if (this.life <= 0) this.active = false;
    }
}

class Monster {
    constructor(x, y, opts = {}) {
        this.x = x;
        this.y = y;
        this.radius = opts.radius || 0.22;
        this.health = opts.health || 30;
        this.maxHealth = this.health;
        this.isAlive = true;
        this.color = DEMON_BODY_COLOR; // kept for minimap
        this.damage = opts.damage || 10;
        this.lastAttackTime = 0;
        this.speed = opts.speed || 1.0;
    }

    distanceTo(px, py) {
        let dx = this.x - px;
        let dy = this.y - py;
        return Math.sqrt(dx*dx + dy*dy);
    }

    takeDamage(dmg) {
        if (!this.isAlive) return;
        this.health -= dmg;
        if (this.health <= 0) {
            this.isAlive = false;
        }
    }

    update(game, dt) {
        if (!this.isAlive) return;

        let dx = game.player.x - this.x;
        let dy = game.player.y - this.y;
        let dist = Math.sqrt(dx*dx + dy*dy);

        if (dist < 6 && dist > 0.5) {

            let nx = this.x + (dx/dist) * dt * this.speed;
            let ny = this.y + (dy/dist) * dt * this.speed;
            if (!game.isWall(nx, this.y)) this.x = nx;
            if (!game.isWall(this.x, ny)) this.y = ny;
        }

        if (dist < 0.7 && performance.now() - this.lastAttackTime > 700) {
            game.playerHit(this.damage);
            this.lastAttackTime = performance.now();
        }
    }
}

function getSpawnPositions(playerPos, count, minDist = 2.5) {

    let openTiles = [];
    for (let y = 1; y < MAP_HEIGHT-1; ++y) {
        for (let x = 1; x < MAP_WIDTH-1; ++x) {
            if (MAP[y][x] === ".") {
                let d = Math.sqrt((playerPos.x - x - 0.5)**2 + (playerPos.y - y - 0.5)**2);
                if (d > minDist) openTiles.push({x: x+0.5, y: y+0.5});
            }
        }
    }

    for (let i = openTiles.length - 1; i > 0; --i) {
        let j = Math.floor(Math.random() * (i+1));
        [openTiles[i], openTiles[j]] = [openTiles[j], openTiles[i]];
    }

    return openTiles.slice(0, count);
}

class DoomGame {
    constructor(container) {

        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.container = container;

        this.canvas = document.createElement('canvas');
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);

        this.player = {
            x: 2.5,
            y: 2.5,
            dir: 0, // radians
            move: 0,
            strafe: 0,
            rot: 0,
            health: 100,
            ammo: 50,
            shoot: false,
            shootCooldown: 0
        };

        this.inMenu = true;
        this.menuDiv = null;

        this.lastTime = 0;

        this.keys = {};
        this.monsters = [];
        this.bullets = []; // --- NEW: bullets array ---

        this.wave = 1;
        this.waveInProgress = false;
        this.waveTransitionTime = 0; // time left on "Wave X" banner

        this.bindEvents();

        this.handleResize = this.handleResize.bind(this);
        window.addEventListener('resize', this.handleResize);
        this.handleResize();

        this.showMenu();

        this.render = this.render.bind(this);
    }

    spawnMonstersForWave() {


        let n = 2 + Math.floor(this.wave * 1.1); // number of monsters
        let hp = Math.floor(24 + 7 * (this.wave-1) * 0.8); // base health
        let dmg = Math.floor(8 + 2 * (this.wave-1) * 0.7); // base damage
        let speed = 1.0 + 0.07 * (this.wave-1); // monsters get faster

        let spawnPoints = getSpawnPositions(this.player, n, 2.5 + 0.05*this.wave);
        if (spawnPoints.length < n) n = spawnPoints.length; // fallback

        this.monsters = [];
        for (let i = 0; i < n; ++i) {
            let pos = spawnPoints[i];
            this.monsters.push(new Monster(
                pos.x, pos.y, {
                    health: hp,
                    damage: dmg,
                    speed: speed
                }
            ));
        }
    }

    handleResize() {

        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.canvas.style.width = '100vw';
        this.canvas.style.height = '100vh';
    }

    showMenu() {

        this.menuDiv = document.createElement('div');
        this.menuDiv.className = 'menu';
        this.menuDiv.innerHTML = `
            <div style="font-size:2.4rem; color:#f00; letter-spacing:4px; font-weight:bold; margin-bottom:18px;">
                DOOM<br><span style="font-size:1rem; color:#fff;">MS-DOS DEMO</span>
            </div>
            <button id="startBtn">START</button>
            <div style="margin-top:18px; font-size:1.1rem; color:#ff0;">
                [WASD] Move<br>[←][→] Turn<br>[SPACE] Shoot<br>[ESC] Menu
            </div>
        `;
        document.body.appendChild(this.menuDiv);
        document.getElementById('startBtn').onclick = () => {
            this.startGame();
        };
    }

    startGame() {
        if (this.menuDiv) {
            document.body.removeChild(this.menuDiv);
            this.menuDiv = null;
        }
        this.inMenu = false;

        this.player.x = 2.5;
        this.player.y = 2.5;
        this.player.dir = 0;
        this.player.health = 100;
        this.player.ammo = 50;
        this.player.shootCooldown = 0;
        this.bullets = []; // --- NEW: clear bullets on new game ---
        this.wave = 1;
        this.waveInProgress = true;
        this.waveTransitionTime = 1.2; // seconds to show "WAVE 1" banner
        this.spawnMonstersForWave();
        this.lastTime = performance.now();
        this.handleResize(); // Ensure canvas size matches when entering game
        this.render();
    }

    bindEvents() {
        window.addEventListener('keydown', (e) => {
            if (this.inMenu) return;
            if (e.code === 'KeyW') this.player.move = 1;
            if (e.code === 'KeyS') this.player.move = -1;
            if (e.code === 'KeyA') this.player.strafe = -1;
            if (e.code === 'KeyD') this.player.strafe = 1;
            if (e.code === 'ArrowLeft') this.player.rot = -1;
            if (e.code === 'ArrowRight') this.player.rot = 1;
            if (e.code === 'Space') this.player.shoot = true;
            if (e.code === 'Escape') {
                this.inMenu = true;
                this.showMenu();
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyW' && this.player.move === 1) this.player.move = 0;
            if (e.code === 'KeyS' && this.player.move === -1) this.player.move = 0;
            if (e.code === 'KeyA' && this.player.strafe === -1) this.player.strafe = 0;
            if (e.code === 'KeyD' && this.player.strafe === 1) this.player.strafe = 0;
            if (e.code === 'ArrowLeft' && this.player.rot === -1) this.player.rot = 0;
            if (e.code === 'ArrowRight' && this.player.rot === 1) this.player.rot = 0;
            if (e.code === 'Space') this.player.shoot = false;
        });

        window.addEventListener('keydown', (e) => {
            if (!this.inMenu) return;
            if (e.code === "Enter") {
                this.startGame();
            }
        });
    }

    isWall(x, y) {

        if (x < 0 || y < 0 || x >= MAP_WIDTH || y >= MAP_HEIGHT) return true;
        return MAP[Math.floor(y)][Math.floor(x)] === '#';
    }

    playerHit(dmg) {
        this.player.health -= dmg;
        if (this.player.health < 0) this.player.health = 0;
    }

    update(dt) {

        let allowInput = (this.waveTransitionTime <= 0);

        if (allowInput) {
            this.player.dir += this.player.rot * dt * 2.5;

            if (this.player.dir < 0) this.player.dir += Math.PI * 2;
            if (this.player.dir > Math.PI * 2) this.player.dir -= Math.PI * 2;

            let moveStep = this.player.move * dt * 2.5;
            let strafeStep = this.player.strafe * dt * 2.2;
            let nx = this.player.x + Math.cos(this.player.dir) * moveStep + Math.cos(this.player.dir + Math.PI/2) * strafeStep;
            let ny = this.player.y + Math.sin(this.player.dir) * moveStep + Math.sin(this.player.dir + Math.PI/2) * strafeStep;

            let blocked = false;
            for (let m of this.monsters) {
                if (!m.isAlive) continue;
                let d = Math.sqrt((nx - m.x) ** 2 + (this.player.y - m.y) ** 2);
                if (d < m.radius + 0.26) blocked = true;
            }
            if (!this.isWall(nx, this.player.y) && !blocked) this.player.x = nx;

            blocked = false;
            for (let m of this.monsters) {
                if (!m.isAlive) continue;
                let d = Math.sqrt((this.player.x - m.x) ** 2 + (ny - m.y) ** 2);
                if (d < m.radius + 0.26) blocked = true;
            }
            if (!this.isWall(this.player.x, ny) && !blocked) this.player.y = ny;

            for (let monster of this.monsters) {
                monster.update(this, dt);
            }

            if (this.player.shoot && this.player.shootCooldown <= 0 && this.player.ammo > 0) {
                this.fireWeapon();
                this.player.shootCooldown = 0.25; // seconds between shots
            }
            this.player.shootCooldown -= dt;
            if (this.player.shootCooldown < 0) this.player.shootCooldown = 0;
        } else {

            for (let monster of this.monsters) {
                monster.update(this, dt);
            }
            this.player.shootCooldown = 0;
        }

        for (let bullet of this.bullets) {
            bullet.update(this, dt);
        }

        this.bullets = this.bullets.filter(b => b.active);
    }

    fireWeapon() {
        this.player.ammo -= 1;

        const px = this.player.x, py = this.player.y, pd = this.player.dir;
        this.bullets.push(new Bullet(px, py, pd));

        let bestDist = Infinity, bestMonster = null;

        for (let monster of this.monsters) {
            if (!monster.isAlive) continue;

            let dx = monster.x - px;
            let dy = monster.y - py;
            let dist = Math.sqrt(dx*dx + dy*dy);
            if (dist > 7) continue; // out of range

            let angleToMonster = Math.atan2(dy, dx);
            let da = Math.abs(((pd - angleToMonster + Math.PI*3) % (Math.PI*2)) - Math.PI);
            if (da < 0.17) { // within ~10 degrees

                let blocked = false;
                for (let t = 0.1; t < dist; t += 0.04) {
                    let rx = px + Math.cos(pd) * t;
                    let ry = py + Math.sin(pd) * t;
                    if (this.isWall(rx, ry)) {
                        blocked = true;
                        break;
                    }
                }
                if (!blocked && dist < bestDist) {
                    bestDist = dist;
                    bestMonster = monster;
                }
            }
        }
        if (bestMonster) {
            bestMonster.takeDamage(20);
        }
    }

    getMonsterAtRay(rx, ry, excludeDead = true) {
        for (let m of this.monsters) {
            if (!m.isAlive && excludeDead) continue;
            let dx = rx - m.x, dy = ry - m.y;
            if ((dx*dx + dy*dy) < m.radius*m.radius)
                return m;
        }
        return null;
    }

    drawEnemySprite(ctx, x, y, w, h, monster, isDead = false) {


        if (!ENEMY_IMAGE_LOADED) {

            ctx.save();
            ctx.globalAlpha = 0.8;
            ctx.fillStyle = "#888";
            ctx.fillRect(x, y, w, h);
            ctx.restore();
            return;
        }

        ctx.save();

        if (isDead) {
            ctx.globalAlpha = 0.28;
        }



        const img = ENEMY_IMAGE;
        const imgW = img.width;
        const imgH = img.height;
        if (imgW === 0 || imgH === 0) {

            ctx.fillStyle = "#444";
            ctx.fillRect(x, y, w, h);
            ctx.restore();
            return;
        }

        let aspect = imgW / imgH;
        let drawW = w, drawH = h;
        if (drawW / drawH > aspect) {
            drawW = drawH * aspect;
        } else {
            drawH = drawW / aspect;
        }

        let drawX = x + (w - drawW) / 2;
        let drawY = y + (h - drawH);

        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 0, 0, imgW, imgH, drawX, drawY, drawW, drawH);

        if (isDead) {
            ctx.globalAlpha = 0.55;
            ctx.fillStyle = "#a00";
            ctx.fillRect(drawX, drawY, drawW, drawH);
        }

        ctx.restore();
    }

    projectWorldToScreen(wx, wy) {

        const px = this.player.x;
        const py = this.player.y;
        const pd = this.player.dir;

        const dx = wx - px;
        const dy = wy - py;
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist < 0.01) return {onScreen: false};

        let angle = Math.atan2(dy, dx) - pd;

        while (angle < -Math.PI) angle += Math.PI * 2;
        while (angle > Math.PI) angle -= Math.PI * 2;

        if (Math.abs(angle) > FOV / 1.35) {
            return {onScreen: false}; // outside of FOV
        }

        const rel = 0.5 + angle / FOV;
        const screenX = rel * this.width;

        const projSize = Math.min(this.height, this.height / (dist + 0.0001));
        const screenY = this.height / 2;

        return {
            x: screenX,
            y: screenY,
            size: projSize * 0.1, // bullet visual size, tweak as needed
            onScreen: true,
            dist: dist
        };
    }

    renderScene() {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.width, this.height);

        ctx.fillStyle = '#3366cc';
        ctx.fillRect(0, 0, this.width, this.height/2);

        ctx.fillStyle = '#444400';
        ctx.fillRect(0, this.height/2, this.width, this.height/2);

        const stripW = this.width / NUM_RAYS;
        let px = this.player.x;
        let py = this.player.y;
        let pd = this.player.dir;

        let spriteRenders = [];

        for (let i = 0; i < NUM_RAYS; ++i) {

            let rayAngle = pd - FOV/2 + (i/NUM_RAYS)*FOV;
            let sinA = Math.sin(rayAngle);
            let cosA = Math.cos(rayAngle);

            let dist = 0;
            let hit = false;
            let wallX = 0;
            let wallY = 0;
            let monsterHit = null;
            while (!hit && dist < VIEW_DIST) {
                dist += 0.025;
                let rx = px + cosA * dist;
                let ry = py + sinA * dist;

                if (!monsterHit) {
                    monsterHit = this.getMonsterAtRay(rx, ry);
                }
                if (this.isWall(rx, ry)) {
                    hit = true;
                    wallX = rx;
                    wallY = ry;
                }
            }

            if (monsterHit && monsterHit.isAlive) {
                let dx = monsterHit.x - px;
                let dy = monsterHit.y - py;
                let mDist = Math.sqrt(dx*dx + dy*dy);
                let angleToMonster = Math.atan2(dy, dx);
                let relAngle = angleToMonster - pd;

                if (Math.abs(relAngle) < FOV/1.5) {
                    let projH = Math.min(this.height, this.height / (mDist * Math.cos(rayAngle - pd) + 0.0001));
                    spriteRenders.push({
                        dist: mDist,
                        screenX: i * stripW,
                        width: Math.max(stripW + 1, projH * 0.42),
                        height: projH,
                        monster: monsterHit
                    });
                }
            }

            const correctedDist = dist * Math.cos(rayAngle - pd);

            let wallH = Math.min(this.height, this.height / (correctedDist+0.0001));
            let shade = Math.max(0, 180 - correctedDist*32);
            ctx.fillStyle = `rgb(${shade},${shade/2},${shade/2})`;
            ctx.fillRect(i*stripW, (this.height-wallH)/2, stripW+1, wallH);

            if (hit) {
                let wx = Math.floor(wallX);
                let wy = Math.floor(wallY);
                if ((wx + wy) % 2 === 0 && wallH > 10) {
                    ctx.strokeStyle = `rgba(255,40,40,${0.15 + 0.12*Math.random()})`;
                    ctx.beginPath();
                    ctx.moveTo(i*stripW+stripW/2, (this.height-wallH)/2);
                    ctx.lineTo(i*stripW+stripW/2, (this.height+wallH)/2);
                    ctx.stroke();
                }
            }
        }


        let sortedBullets = this.bullets
            .map(bullet => {
                const proj = this.projectWorldToScreen(bullet.x, bullet.y);
                return proj.onScreen ? {bullet, proj} : null;
            })
            .filter(Boolean)
            .sort((a, b) => b.proj.dist - a.proj.dist);

        for (let binfo of sortedBullets) {
            let {bullet, proj} = binfo;
            let alpha = Math.max(0.3, Math.min(1, bullet.life * 2.5));
            ctx.save();
            ctx.globalAlpha = alpha;

            let color = (bullet.life > 0.36) ? "#fffc" : "#ff3";
            ctx.beginPath();
            ctx.arc(proj.x, proj.y, proj.size, 0, Math.PI*2);
            ctx.fillStyle = color;
            ctx.shadowBlur = Math.max(6, proj.size*1.5);
            ctx.shadowColor = "#fff";
            ctx.fill();
            ctx.restore();
        }

        spriteRenders.sort((a, b) => b.dist - a.dist);
        for (let sprite of spriteRenders) {
            if (!sprite.monster.isAlive) continue;
            let sx = sprite.screenX - sprite.width/2 + stripW/2;
            let sy = (this.height - sprite.height) / 2;

            this.drawEnemySprite(ctx, sx, sy, sprite.width, sprite.height, sprite.monster, !sprite.monster.isAlive);
        }

        ctx.save();
        ctx.translate(this.width/2, this.height*0.82);

        ctx.fillStyle = "#333";
        ctx.fillRect(-26, 0, 52, 32);

        ctx.fillStyle = "#777";
        ctx.fillRect(-14, 0, 28, 18);

        ctx.fillStyle = "#aaa";
        let recoil = (this.player.shootCooldown > 0.15) ? 7 : 0;
        ctx.fillRect(-6, recoil, 12, 20-recoil);
        ctx.restore();

        ctx.fillStyle = "#000";
        ctx.globalAlpha = 0.65;
        ctx.fillRect(0, this.height-40, this.width, 40);
        ctx.globalAlpha = 1;
        ctx.font = "bold 20px 'Consolas', monospace";
        ctx.fillStyle = "#f00";
        ctx.fillText(`HEALTH: ${this.player.health}`, 12, this.height-14);
        ctx.fillStyle = "#ff0";
        ctx.fillText(`AMMO: ${this.player.ammo}`, this.width-120, this.height-14);

        ctx.font = "bold 18px 'Consolas', monospace";
        ctx.fillStyle = "#0ff";
        ctx.fillText(`WAVE: ${this.wave}`, 12, 30);

        const mm = 7, mms = 12;
        for (let y = 0; y < mm; ++y) {
            for (let x = 0; x < mm; ++x) {
                ctx.fillStyle = MAP[y][x]==="#" ? "#bbb" : "#222";
                ctx.fillRect(8 + x*mms, 8 + y*mms, mms-2, mms-2);
            }
        }

        for (let m of this.monsters) {
            if (!m.isAlive) continue;
            ctx.save();
            ctx.translate(8+m.x*mms, 8+m.y*mms);
            let s = 5; // demon minimap size

            ctx.fillStyle = DEMON_BODY_COLOR;
            ctx.beginPath();
            ctx.arc(0, 0, s, 0, Math.PI*2);
            ctx.fill();

            ctx.fillStyle = DEMON_PUPIL_COLOR;
            ctx.beginPath();
            ctx.arc(-1.5, -1, 1, 0, Math.PI*2);
            ctx.arc(1.5, -1, 1, 0, Math.PI*2);
            ctx.fill();

            ctx.strokeStyle = DEMON_HORN_COLOR;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(-2, -4);
            ctx.lineTo(-3.2, -7);
            ctx.moveTo(2, -4);
            ctx.lineTo(3.2, -7);
            ctx.stroke();
            ctx.restore();
        }

        ctx.save();
        ctx.translate(8 + this.player.x*mms, 8 + this.player.y*mms);
        ctx.rotate(this.player.dir);
        ctx.fillStyle = "#0ff";
        ctx.beginPath();
        ctx.arc(0, 0, 4, 0, Math.PI*2);
        ctx.fill();
        ctx.strokeStyle = "#0ff";
        ctx.beginPath();
        ctx.moveTo(0,0);
        ctx.lineTo(6,0);
        ctx.stroke();
        ctx.restore();

        if (this.waveTransitionTime > 0) {
            ctx.save();
            ctx.globalAlpha = Math.min(1, this.waveTransitionTime * 1.2);
            ctx.font = "bold 46px 'Consolas', monospace";
            ctx.textAlign = "center";
            ctx.fillStyle = "#0ff";
            ctx.strokeStyle = "#002";
            ctx.lineWidth = 7;
            let msg = `WAVE ${this.wave}`;
            ctx.strokeText(msg, this.width/2, this.height/3);
            ctx.fillText(msg, this.width/2, this.height/3);
            ctx.restore();
        }
    }

    render(now) {
        if (this.inMenu) return;
        if (!now) now = performance.now();
        let dt = Math.min((now - this.lastTime) / 1000, 0.1);
        this.lastTime = now;

        if (this.waveTransitionTime > 0) {
            this.waveTransitionTime -= dt;
            if (this.waveTransitionTime < 0) this.waveTransitionTime = 0;
        }

        this.update(dt);
        this.renderScene();

        if (this.player.health <= 0) {
            this.inMenu = true;
            setTimeout(() => {
                alert(`You died on Wave ${this.wave}!`);
                this.showMenu();
            }, 200);
            return;
        }

        if (this.monsters.length > 0 && this.monsters.every(m => !m.isAlive)) {
            if (this.waveInProgress) {
                this.waveInProgress = false;

                this.player.ammo += 8 + Math.floor(this.wave*0.5);
                if (this.player.ammo > 99) this.player.ammo = 99;
                this.player.health += 10 + Math.floor(this.wave*0.7);
                if (this.player.health > 100) this.player.health = 100;

                this.waveTransitionTime = 1.1;
                setTimeout(() => {
                    this.wave++;
                    this.waveTransitionTime = 1.15;
                    this.waveInProgress = true;
                    this.spawnMonstersForWave();
                }, 1200);
            }
        } else {
            this.waveInProgress = true;
        }

        requestAnimationFrame(this.render);
    }
}

function initGame() {
    const container = document.getElementById('gameContainer');
    container.innerHTML = '';
    new DoomGame(container);
}

window.addEventListener('DOMContentLoaded', initGame);
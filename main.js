import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';

// === GLOBALS ===
let canvas, scene, camera, renderer, composer;
let meshes = {};
let maxCounts = {};
let blocksGroup;
let dirLight, ambientLight;
const clock = new THREE.Clock();

// Game State & Audio
let isAxeEquipped = false;
let clickBoxesInstruction;
const breakableBlocks = [];
const skillsList = ["Python", "Java", "C++", "HTML", "DBMS", "Web Development", "Cloud-Computing"];
let skillsRevealed = 0;
let scrollLocked = false;
let lockScrollY = 0;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Mobs & Particles
const mobs = [];

// === TYPEWRITER EFFECT ===
const roles = ["Web Development", "DevOps", "Cloud Computing"];
let roleIndex = 0;
let charIndex = 0;

function typeEffect() {
    const typewriterElement = document.getElementById('typewriter-text');
    if (!typewriterElement) return;

    const currentRole = roles[roleIndex];
    
    // Typing
    typewriterElement.textContent = currentRole.substring(0, charIndex + 1);
    charIndex++;
    
    if (charIndex === currentRole.length) {
        // Finished typing, wait then fade out
        setTimeout(() => {
            typewriterElement.style.transition = "opacity 0.5s ease";
            typewriterElement.style.opacity = "0";
            
            setTimeout(() => {
                charIndex = 0;
                roleIndex = (roleIndex + 1) % roles.length;
                typewriterElement.textContent = "";
                typewriterElement.style.transition = "none";
                typewriterElement.style.opacity = "1";
                setTimeout(typeEffect, 200);
            }, 500); // Wait for fade out
        }, 2000); // Wait 2s before fading
        return;
    }
    setTimeout(typeEffect, 100);
}
// Start typing immediately after DOM loads
document.addEventListener("DOMContentLoaded", typeEffect);

// Mobile detection
const isMobile = window.innerWidth <= 768 || navigator.maxTouchPoints > 0;

// Performance limits
const maxGrass = isMobile ? 3000 : 10000;
const maxDirt = isMobile ? 2500 : 8000;
const maxWood = isMobile ? 1000 : 4000;
const maxLeaves = isMobile ? 2000 : 8000;
const maxSandstone = isMobile ? 1000 : 4000;

function init() {
    setupScene();
    setupLights();
    createWorld();
    createSpecialScenes();
    setupPostProcessing();
    setupScrollAnimation();
    setupInteractions();
    
    // Scroll Lock Listener
    window.addEventListener('scroll', () => {
        if (scrollLocked && window.scrollY > lockScrollY) {
            window.scrollTo(0, lockScrollY);
        }
    }, { passive: false });

    window.addEventListener('resize', onWindowResize);
    animate();
}

function setupScene() {
    canvas = document.querySelector('#bg-canvas');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB);
    scene.fog = new THREE.FogExp2(0x87CEEB, 0.015);

    camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 150);
    // Hero Start: High up
    camera.position.set(0, 15, 10);
    camera.lookAt(0, 0, -20);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(isMobile ? 1.0 : Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = !isMobile;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

function setupLights() {
    ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    dirLight = new THREE.DirectionalLight(0xfff5b6, 2.5);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = !isMobile;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 300;
    const d = 100;
    dirLight.shadow.camera.left = -d;
    dirLight.shadow.camera.right = d;
    dirLight.shadow.camera.top = d;
    dirLight.shadow.camera.bottom = -d;
    scene.add(dirLight);
}

function setupPostProcessing() {
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    if (!isMobile) {
        const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
        ssaoPass.kernelRadius = 16;
        ssaoPass.minDistance = 0.005;
        ssaoPass.maxDistance = 0.1;
        composer.addPass(ssaoPass);
    }

    const bloomResolution = isMobile ? new THREE.Vector2(window.innerWidth / 2, window.innerHeight / 2) : new THREE.Vector2(window.innerWidth, window.innerHeight);
    const bloomPass = new UnrealBloomPass(bloomResolution, 1.0, 0.4, 0.85);
    composer.addPass(bloomPass);

    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms["offset"].value = 1.0;
    vignettePass.uniforms["darkness"].value = 1.2;
    composer.addPass(vignettePass);

    const gammaPass = new ShaderPass(GammaCorrectionShader);
    composer.addPass(gammaPass);
}

function createNoiseTexture(colorBase) {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(64, 64);
    for (let i = 0; i < imgData.data.length; i += 4) {
        const val = Math.random() * 40;
        imgData.data[i] = colorBase[0] + val; 
        imgData.data[i+1] = colorBase[1] + val; 
        imgData.data[i+2] = colorBase[2] + val; 
        imgData.data[i+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    return tex;
}

function createWorld() {
    blocksGroup = new THREE.Group();
    scene.add(blocksGroup);

    const matGrass = new THREE.MeshStandardMaterial({ map: createNoiseTexture([20, 150, 40]), roughness: 0.9 });
    const matDirt = new THREE.MeshStandardMaterial({ map: createNoiseTexture([80, 50, 30]), roughness: 1.0 });
    const matWood = new THREE.MeshStandardMaterial({ map: createNoiseTexture([60, 40, 20]), roughness: 0.9 });
    const matLeaves = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.9, transparent: true, opacity: 0.95 });
    const matSandstone = new THREE.MeshStandardMaterial({ map: createNoiseTexture([210, 180, 140]), roughness: 0.8 });

    const geometry = new THREE.BoxGeometry(1, 1, 1);

    meshes.grass = new THREE.InstancedMesh(geometry, matGrass, maxGrass);
    meshes.dirt = new THREE.InstancedMesh(geometry, matDirt, maxDirt);
    meshes.wood = new THREE.InstancedMesh(geometry, matWood, maxWood);
    meshes.leaves = new THREE.InstancedMesh(geometry, matLeaves, maxLeaves);
    meshes.sandstone = new THREE.InstancedMesh(geometry, matSandstone, maxSandstone);

    maxCounts = { grass: maxGrass, dirt: maxDirt, wood: maxWood, leaves: maxLeaves, sandstone: maxSandstone };

    Object.values(meshes).forEach(m => {
        m.castShadow = true; 
        m.receiveShadow = true;
        m.frustumCulled = false; // Prevent culling issues for trees/houses
        blocksGroup.add(m);
    });

    let counts = { grass: 0, dirt: 0, wood: 0, leaves: 0, sandstone: 0 };
    const dummy = new THREE.Object3D();

    function addBlock(type, x, y, z) {
        if(counts[type] >= maxCounts[type]) return;
        dummy.position.set(x, y, z);
        dummy.updateMatrix();
        meshes[type].setMatrixAt(counts[type]++, dummy.matrix);
    }

    window.addTree = function(baseX, baseY, baseZ, isGiant = false) {
        const height = isGiant ? 10 : Math.floor(Math.random() * 3) + 4;
        for (let y = 0; y < height; y++) addBlock('wood', baseX, baseY + y, baseZ);
        const leafSpread = isGiant ? 5 : 2;
        for (let y = height - 2; y <= height + (isGiant ? 4 : 1); y++) {
            for (let x = -leafSpread; x <= leafSpread; x++) {
                for (let z = -leafSpread; z <= leafSpread; z++) {
                    if (Math.abs(x) == leafSpread && Math.abs(z) == leafSpread) continue;
                    if (x !== 0 || z !== 0 || y > height - 1) {
                        if(Math.random() > 0.1) addBlock('leaves', baseX + x, baseY + y, baseZ + z);
                    }
                }
            }
        }
        meshes['wood'].count = counts['wood'];
        meshes['leaves'].count = counts['leaves'];
        meshes['wood'].instanceMatrix.needsUpdate = true;
        meshes['leaves'].instanceMatrix.needsUpdate = true;
    }

    // Generate L-shaped path: Forward (-Z), Left (-X), Forward (-Z), Left (-X)
    const genArea = (sx, ex, sz, ez) => {
        for(let x=sx; x<=ex; x++) {
            for(let z=sz; z>=ez; z--) {
                let y = Math.floor(Math.sin(x/4) + Math.cos(z/4));
                // Flatten the exact walking path
                if (z > -25 && Math.abs(x) < 4) y = 0;
                if (x > -50 && Math.abs(z+20) < 4) y = 0;
                if (z > -80 && Math.abs(x+50) < 4) y = 0;
                // Flatten the area under the Skills boxes so they don't clip
                if (x >= -14 && x <= -4 && z <= -3 && z >= -17) y = -2;
                // Flatten the area under the Projects plants so they are perfectly level
                if (x >= -48 && x <= -42 && z <= -12 && z >= -28) y = -1;
                
                addBlock('grass', x, y, z);
                addBlock('dirt', x, y-1, z);
            }
        }
    };

    if (isMobile) {
        genArea(-8, 8, 20, -30);
        genArea(-60, -15, -15, -25);
        genArea(-55, -45, -30, -90);
        genArea(-90, -60, -75, -85);
    } else {
        // Hero -> What I do (Forward Z)
        genArea(-15, 15, 20, -30);
        // Skills -> Projects (Left X)
        genArea(-60, -15, -10, -30);
        // Experience -> Connect (Forward Z)
        genArea(-60, -40, -30, -90);
        // Connect (Left X)
        genArea(-90, -60, -70, -90);
    }

    Object.keys(meshes).forEach(type => {
        meshes[type].count = counts[type];
        meshes[type].instanceMatrix.needsUpdate = true;
    });
}

function createTextSprite(text, fontSize = 40, color = 'white', bgColor = null) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    
    if (bgColor) {
        ctx.fillStyle = bgColor;
        ctx.fillRect(0, 0, 1024, 256);
        // Add a subtle border to the glass box
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.strokeRect(2, 2, 1020, 252);
    }
    
    ctx.font = `bold ${fontSize * 1.8}px "Press Start 2P", Courier, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    if (!bgColor) {
        // Use a sharp stroke instead of a glowing shadow for maximum clarity
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.strokeText(text, 512, 128);
    } else {
        // Drop shadow for text inside the colored box
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetX = 2;
        ctx.shadowOffsetY = 2;
    }
    
    // Draw white text inside
    ctx.fillStyle = color;
    ctx.fillText(text, 512, 128);
    
    const tex = new THREE.CanvasTexture(canvas);
    // Add anisotropic filtering to keep crisp at angles
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const spriteMat = new THREE.SpriteMaterial({ map: tex });
    const sprite = new THREE.Sprite(spriteMat);
    sprite.scale.set(8, 2, 1);
    return sprite;
}

function createSpecialScenes() {
    // 1. The 7 Skills Sandstone Blocks (Tightly packed, horizontally centered around Z = -10)
    let bz = -5.5; // Center is -10, spacing is 1.5. Spans from -5.5 to -14.5
    skillsList.forEach((skill, i) => {
        const mat = new THREE.MeshStandardMaterial({ color: 0xeeddcc, roughness: 0.9 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
        box.position.set(-10, -1.0, bz); // Y=-1.0 is just above the flattened terrain, X=-10 is close to camera
        box.castShadow = true;
        box.userData = { isBreakable: true, skill: skill };
        scene.add(box);
        breakableBlocks.push(box);

        bz -= 1.5; // Tighter spacing so they fit beautifully on screen
    });

    // Big bouncing text over the center box (Z = -10)
    clickBoxesInstruction = createTextSprite("click the boxes!", 30, '#ffaa00');
    clickBoxesInstruction.position.set(-10, 1.0, -10);
    clickBoxesInstruction.scale.set(4, 1, 1);
    scene.add(clickBoxesInstruction);

    // Custom ultra-high-resolution sprite generator for long project texts
    function createProjectSprite(text) {
        const canvas = document.createElement('canvas');
        canvas.width = 2048; // Huge width for long text
        canvas.height = 512; // Increased height to prevent vertical squishing
        const ctx = canvas.getContext('2d');
        
        // V-shaped torch light effect (Yellow gradient spreading upwards)
        const gradient = ctx.createLinearGradient(0, 512, 0, 0);
        gradient.addColorStop(0, 'rgba(255, 220, 0, 0.8)'); // Bright yellow at bottom (source)
        gradient.addColorStop(0.5, 'rgba(255, 220, 0, 0.3)'); // Fading out
        gradient.addColorStop(1, 'rgba(255, 220, 0, 0.0)');   // Completely faded at top

        ctx.fillStyle = gradient;
        ctx.beginPath();
        // Base of the light (near the plant)
        ctx.moveTo(1024 - 200, 512); 
        ctx.lineTo(1024 + 200, 512);
        // Spreading out to the top corners in a V-shape
        ctx.lineTo(2048, 0);         
        ctx.lineTo(0, 0);            
        ctx.closePath();
        ctx.fill();

        // Clean, highly legible sans-serif font without bold, slightly larger
        ctx.font = '120px "Inter", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Draw crisp manual shadow (more reliable than ctx.shadow)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillText(text, 1024 + 5, 256 + 5);
        
        // Draw thin black outline
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'black';
        ctx.strokeText(text, 1024, 256);
        
        // Draw main green text to match theme
        ctx.fillStyle = '#10b981';
        ctx.fillText(text, 1024, 256);
        
        const tex = new THREE.CanvasTexture(canvas);
        tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        
        // CRITICAL FIX: Enable mipmaps for clean downscaling! 
        // (LinearFilter without mipmaps causes extreme pixelation when shrinking 2048px textures)
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipMapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        
        const spriteMat = new THREE.SpriteMaterial({ map: tex });
        const sprite = new THREE.Sprite(spriteMat);
        
        // Scale to 4:1 aspect ratio to match canvas (2048:512 = 4:1). Width 2.8 fits spacing!
        sprite.scale.set(2.8, 0.7, 1);
        return sprite;
    }

    // 2. The 4 Project Plants (Horizontal row perfectly parallel to camera at X=-38)
    const projectTexts = ["E-Voting system", "LMS Platform", "Websites", "Crop Prediction Tool"];
    let pz = -15.5; // Center is -20. Spacing is 3 units.
    projectTexts.forEach((p, i) => {
        // Dirt base (pot)
        const matDirt = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 1.0 });
        const dirt = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matDirt);
        dirt.position.set(-45, 0, pz);
        dirt.castShadow = true;
        scene.add(dirt);

        // Leaves top (plant)
        const matLeaves = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.9 });
        const leaves = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), matLeaves);
        leaves.position.set(-45, 1, pz);
        leaves.castShadow = true;
        scene.add(leaves);

        // Project text floating exactly in front/above the plant
        const sprite = createProjectSprite(p);
        sprite.position.set(-45, 2.5, pz);
        scene.add(sprite);

        pz -= 3; // Space them out evenly in a line
    });

    // 3. Connect With Me House (Red & Silver, Evening, X = -80, Z = -80)
    const matRed = new THREE.MeshStandardMaterial({ color: 0xaa2222, roughness: 0.8 });
    const matSilver = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.6, roughness: 0.4 });
    const houseGrp = new THREE.Group();
    for(let x=-4; x<=4; x++) {
        for(let z=-4; z<=4; z++) {
            for(let y=1; y<=5; y++) {
                if(Math.abs(x)==4 || Math.abs(z)==4) {
                    if (x===0 && z===4 && y<=2) continue; // Door
                    const m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), Math.random() > 0.5 ? matRed : matSilver);
                    m.position.set(x, y, z);
                    m.castShadow = true;
                    m.frustumCulled = false;
                    houseGrp.add(m);
                }
            }
        }
    }
    // Roof
    for(let x=-5; x<=5; x++) {
        for(let z=-5; z<=5; z++) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), matSilver);
            m.position.set(x, 6, z);
            m.frustumCulled = false;
            houseGrp.add(m);
        }
    }
    houseGrp.position.set(-80, 0, -80);
    scene.add(houseGrp);

    // Player at House
    buildMob(0xffccaa, 0x00aaff, 0x0000aa, -75, 2, -75, 'player');
    // Birds
    buildMob(0xffffff, 0x000000, 0xff0000, -80, 15, -80, 'bird');
    buildMob(0xaaaaaa, 0x000000, 0xff0000, -82, 16, -78, 'bird');
}

function buildMob(cHead, cShirt, cPants, x, y, z, type) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const mH = new THREE.MeshStandardMaterial({ color: cHead });
    const mS = new THREE.MeshStandardMaterial({ color: cShirt });
    const mP = new THREE.MeshStandardMaterial({ color: cPants });

    if(type === 'bird') {
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 1), mH);
        const lWing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.5), mS); lWing.position.set(-1,0,0);
        const rWing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 0.5), mS); rWing.position.set(1,0,0);
        group.add(body, lWing, rWing);
        mobs.push({ type: 'bird', group, wings: [lWing, rWing], baseX: x, baseZ: z, phase: Math.random()*10 });
    } else {
        const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), mH); head.position.y = 2;
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.4), mS); body.position.y = 1;
        const lA = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), mH); lA.position.set(-0.6, 1.5, 0);
        const rA = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), mH); rA.position.set(0.6, 1.5, 0);
        const lL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), mP); lL.position.set(-0.2, 0.5, 0);
        const rL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1, 0.3), mP); rL.position.set(0.2, 0.5, 0);
        group.add(head, body, lA, rA, lL, rL);
        mobs.push({ type: 'human', group, limbs: [lA, rA, lL, rL] });
    }
    scene.add(group);
}

function playCrunchSound() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(100, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, audioCtx.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.1);
}

function setupScrollAnimation() {
    const tl = gsap.timeline({
        scrollTrigger: {
            trigger: "body",
            start: "top top",
            end: "bottom bottom",
            scrub: true, // removes lag, strictly syncs HTML and 3D
            onUpdate: (self) => {
                const t = tl.time();
                
                // UI Visibility for Skills (Rest at 2.5 - 3.0)
                const uiWrapper = document.getElementById('skills-ui-wrapper');
                if (uiWrapper) {
                    if (t >= 2.5 && t < 3.0) {
                        if (uiWrapper.style.opacity !== '1') {
                            uiWrapper.style.opacity = '1';
                            uiWrapper.style.pointerEvents = 'auto';
                            document.body.classList.add('axe-cursor');
                            const customCursor = document.getElementById('custom-axe-cursor');
                            if(customCursor) customCursor.style.display = 'block';
                            isAxeEquipped = true;
                        }
                    } else {
                        if (uiWrapper.style.opacity !== '0') {
                            uiWrapper.style.opacity = '0';
                            uiWrapper.style.pointerEvents = 'none';
                            document.body.classList.remove('axe-cursor');
                            const customCursor = document.getElementById('custom-axe-cursor');
                            if(customCursor) customCursor.style.display = 'none';
                            isAxeEquipped = false;
                        }
                    }
                }

                // Scroll Lock Enforcer at Skills
                if (skillsRevealed < skillsList.length) {
                    if (t >= 2.5 && t < 2.6 && self.direction === 1) {
                        if (!scrollLocked) {
                            scrollLocked = true;
                            lockScrollY = window.scrollY;
                        }
                    } else if (t < 2.4) {
                        scrollLocked = false;
                    }
                } else {
                    scrollLocked = false;
                }

                // UI Visibility for Projects (Rest at 3.5 - 4.0)
                const projectsWrapper = document.getElementById('projects-ui-wrapper');
                if (projectsWrapper) {
                    if (t >= 3.5 && t < 4.0) { 
                        if (projectsWrapper.style.opacity !== '1') {
                            projectsWrapper.style.opacity = '1';
                        }
                    } else {
                        if (projectsWrapper.style.opacity !== '0') {
                            projectsWrapper.style.opacity = '0';
                        }
                    }
                }

                // Ensure Experience section only appears when its 3D section is active (Rest at 4.5 - 5.0)
                const expSection = document.getElementById('experience');
                if (expSection) {
                    if (t >= 4.5 && t < 5.0) {
                        expSection.style.opacity = '1';
                    } else {
                        expSection.style.opacity = '0';
                    }
                }
            }
        }
    });

    const skyColor = { r: 135/255, g: 206/255, b: 235/255 }; 
    const sunsetColor = { r: 255/255, g: 100/255, b: 20/255 }; 

    // TIMELINE: 0.5s movement, 0.5s rest per section. 8 sections total = max time 7.5s.
    
    // 0 -> 1: Hero -> About
    tl.to(camera.position, { z: 5, y: 2, x: 0, duration: 0.5 }, 0)
      .to(camera.rotation, { x: 0, duration: 0.5 }, 0);

    // 1 -> 2: About -> What I Do
    tl.to(camera.position, { z: -10, y: 2, x: 0, duration: 0.5 }, 1);

    // 2 -> 3: What I Do -> Skills
    tl.to(camera.rotation, { y: Math.PI / 2, duration: 0.5 }, 2)
      .to(camera.position, { x: -2, duration: 0.5 }, 2); 

    // 3 -> 4: Skills -> Projects
    tl.to(camera.position, { x: -38, z: -20, duration: 0.5 }, 3);

    // 4 -> 5: Projects -> Experience (Turn Right 90deg, go Straight -Z)
    tl.to(camera.rotation, { y: 0, duration: 0.5 }, 4)
      .to(camera.position, { z: -60, x: -50, duration: 0.5 }, 4);

    // 5 -> 6: Experience -> FAQ
    tl.to(camera.position, { z: -70, x: -50, duration: 0.5 }, 5);

    // 6 -> 7: FAQ -> Connect (Sunset)
    tl.to(camera.rotation, { y: Math.PI / 2, duration: 0.5 }, 6)
      .to(camera.position, { x: -65, z: -72, duration: 0.5 }, 6)
      .to(dirLight.position, { x: -100, y: 5, z: -100 }, 6) // Sunset angle
      .to(dirLight, { intensity: 1.5 }, 6)
      .to(skyColor, { r: sunsetColor.r, g: sunsetColor.g, b: sunsetColor.b, 
            onUpdate: () => { 
                scene.background.setRGB(skyColor.r, skyColor.g, skyColor.b); 
                scene.fog.color.setRGB(skyColor.r, skyColor.g, skyColor.b);
            }
      }, 6);
}

function setupInteractions() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const customCursor = document.createElement('div');
    customCursor.id = 'custom-axe-cursor';
    document.body.appendChild(customCursor);

    window.addEventListener('mousemove', (event) => {
        if (isAxeEquipped) {
            customCursor.style.left = event.clientX + 'px';
            customCursor.style.top = event.clientY + 'px';
        }
    });

    window.addEventListener('click', (event) => {
        if (!isAxeEquipped) return;

        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        raycaster.setFromCamera(mouse, camera);

        const intersects = raycaster.intersectObjects(breakableBlocks);
        if (intersects.length > 0) {
            const hit = intersects[0].object;
            playCrunchSound();
            
            // Shatter
            scene.remove(hit);
            if (hit.userData.label) scene.remove(hit.userData.label);
            breakableBlocks.splice(breakableBlocks.indexOf(hit), 1);

            // Fade out the global click instruction
            if (clickBoxesInstruction && clickBoxesInstruction.material.opacity > 0) {
                gsap.to(clickBoxesInstruction.material, { opacity: 0, duration: 0.5 });
            }

            for(let i=0; i<10; i++) {
                const p = new THREE.Mesh(new THREE.BoxGeometry(0.3,0.3,0.3), new THREE.MeshBasicMaterial({color:0xeeddcc}));
                p.position.copy(hit.position);
                p.userData = { vx: (Math.random()-0.5)*3, vy: Math.random()*3, vz: (Math.random()-0.5)*3 };
                scene.add(p);
                mobs.push({ type: 'particle', mesh: p });
            }

            // Update UI
            skillsRevealed++;
            const uiLabel = document.getElementById('active-skill-label');
            uiLabel.innerHTML += `<span class="duration">${hit.userData.skill}</span>`;
            
            // Set hint text dynamically as we break blocks
            if (skillsRevealed >= skillsList.length) {
                scrollLocked = false;
                document.getElementById('break-hint').innerHTML = "All skills revealed! Keep scrolling.";
                document.getElementById('break-hint').style.color = "#55ff55";
            } else {
                document.getElementById('break-hint').innerHTML = "Hit to break blocks!";
                document.getElementById('break-hint').style.color = "#ffaa00";
            }
        }
    });
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    const time = clock.getElapsedTime();

    // Bouncing text animation
    if (clickBoxesInstruction && clickBoxesInstruction.material.opacity > 0) {
        clickBoxesInstruction.position.y = 1.0 + Math.sin(time * 4) * 0.15;
    }

    // Mobs Animation
    for (let i = mobs.length - 1; i >= 0; i--) {
        const m = mobs[i];
        if (m.type === 'human') {
            m.limbs[0].rotation.x = Math.sin(time * 2) * 0.5;
            m.limbs[1].rotation.x = -Math.sin(time * 2) * 0.5;
            m.limbs[2].rotation.x = -Math.sin(time * 2) * 0.5;
            m.limbs[3].rotation.x = Math.sin(time * 2) * 0.5;
        } else if (m.type === 'bird') {
            m.group.position.x = m.baseX + Math.sin(time + m.phase) * 8;
            m.group.position.z = m.baseZ + Math.cos(time + m.phase) * 8;
            m.group.rotation.y = (time + m.phase);
            m.wings[0].rotation.z = Math.sin(time * 20) * 0.8;
            m.wings[1].rotation.z = -Math.sin(time * 20) * 0.8;
        } else if (m.type === 'particle') {
            m.mesh.position.x += m.mesh.userData.vx * 0.1;
            m.mesh.position.y += m.mesh.userData.vy * 0.1;
            m.mesh.position.z += m.mesh.userData.vz * 0.1;
            m.mesh.userData.vy -= 0.1; 
            m.mesh.rotation.x += 0.2;
            m.mesh.rotation.y += 0.2;
            if (m.mesh.position.y < -5) {
                scene.remove(m.mesh);
                mobs.splice(i, 1);
            }
        }
    }

    composer.render();
}

init();

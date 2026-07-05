import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { GammaCorrectionShader } from 'three/addons/shaders/GammaCorrectionShader.js';

// === GLOBALS ===
let canvas, scene, camera, renderer, composer, tl;
let meshes = {};
let maxCounts = {};
let blocksGroup;
let dirLight, ambientLight;
const clock = new THREE.Clock();

// Game State & Audio
let isAxeEquipped = false;
let clickBoxesInstruction;
const breakableBlocks = [];
const skillsList = ["Python", "C++", "Cloud Computing", "DBMS", "MERN Stack", "n8n Automations", "Linux"];
let skillsRevealed = 0;
let isScrollLocked = false;
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

// Performance limits
const maxGrass = 10000, maxDirt = 8000, maxWood = 4000, maxLeaves = 8000, maxSandstone = 4000;

function init() {
    if (history.scrollRestoration) {
        history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);

    setupScene();
    setupLights();
    createWorld();
    createSpecialScenes();
    // setupPostProcessing(); // Disabled for 120fps performance boost
    setupScrollAnimation();
    setupInteractions();

    // Initialize Lenis, ScrollStack, and Custom Snapping Cursor
    initLenis();
    initScrollStack();
    setupTargetCursor();

    // Scroll Lock until all Skills blocks are broken
    window.addEventListener('scroll', () => {
        if (skillsRevealed < skillsList.length) {
            const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
            // Lock at t = 3.3 in camera timeline (where blocks are in view)
            const skillsLockScrollY = Math.round((3.3 / 10) * maxScroll);
            if (window.scrollY >= skillsLockScrollY) {
                isScrollLocked = true;
                window.scrollTo(0, skillsLockScrollY);
                if (lenisInstance) {
                    lenisInstance.stop();
                    lenisInstance.scrollTo(skillsLockScrollY, { immediate: true });
                }
            }
        }
    }, { passive: false });

    window.addEventListener('resize', () => {
        onWindowResize();
        cacheScrollStackPositions();
    });
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
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

function setupLights() {
    ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    dirLight = new THREE.DirectionalLight(0xfff5b6, 2.5);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;  // Reduced from 2048 for major WebGL FPS boost (towards 200fps)
    dirLight.shadow.mapSize.height = 1024;
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

    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.0, 0.4, 0.85);
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

    // Hero -> What I do (Forward Z)
    genArea(-15, 15, 20, -30);
    // Skills -> Projects (Left X)
    genArea(-60, -15, -10, -30);
    // Experience -> Connect (Forward Z)
    genArea(-60, -40, -30, -90);
    // Connect (Left X)
    genArea(-90, -60, -70, -90);

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
    const isMobile = window.innerWidth <= 768;
    skillsList.forEach((skill, i) => {
        const mat = new THREE.MeshStandardMaterial({ color: 0xeeddcc, roughness: 0.9 });
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
        
        let bx = -10;
        let by = -1.0;
        let boxZ = -5.5 - (i * 1.5);
        
        if (isMobile) {
            if (i < 4) {
                // Top row (4 boxes)
                by = 1.0;
                boxZ = -7.75 - (i * 1.5); // Spans -7.75 to -12.25
            } else {
                // Bottom row (3 boxes)
                by = -0.5;
                boxZ = -8.5 - ((i - 4) * 1.5); // Spans -8.5 to -11.5
            }
        }
        
        box.position.set(bx, by, boxZ);
        box.castShadow = true;
        box.userData = { isBreakable: true, skill: skill };
        scene.add(box);
        breakableBlocks.push(box);
    });

    // Big bouncing text over the center box (Z = -10)
    clickBoxesInstruction = createTextSprite("click the boxes!", 30, '#ffaa00');
    const textBaseY = isMobile ? 3.0 : 1.0;
    clickBoxesInstruction.position.set(-10, textBaseY, -10);
    clickBoxesInstruction.userData.baseY = textBaseY;
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

    // Project plants removed - projects are now shown via HTML scroll-stack cards



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
    const isMobile = window.innerWidth <= 768;
    tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });

    const skyColor = { r: 135/255, g: 206/255, b: 235/255 }; 
    const sunsetColor = { r: 255/255, g: 100/255, b: 20/255 }; 

    // Hero -> About (0.0 to 1.06)
    tl.to(camera.position, { z: 5, y: 2, x: 0, duration: 1.06 }, 0)
      .to(camera.rotation, { x: 0, y: 0, z: 0, duration: 1.06 }, 0);

    // About -> What I Do (1.60 to 2.13)
    tl.to(camera.position, { z: -10, y: 2, x: 0, duration: 0.53 }, 1.60);

    // What I Do -> Skills (2.66 to 3.19)
    tl.to(camera.rotation, { y: Math.PI / 2, duration: 0.53 }, 2.66)
      .to(camera.position, { x: isMobile ? 6 : -2, duration: 0.53 }, 2.66); 

    // Skills -> Projects (3.72 to 4.26)
    tl.to(camera.position, { x: isMobile ? -30 : -41, z: -20, duration: 0.54 }, 3.72);

    // Projects -> Experience (7.45 to 8.30)
    tl.to(camera.rotation, { y: 0, duration: 0.85 }, 7.45)
      .to(camera.position, { z: -60, x: -50, duration: 0.85 }, 7.45);

    // Experience -> Contact (9.15 to 10.0)
    tl.to(camera.rotation, { y: Math.PI / 2, duration: 0.85 }, 9.15)
      .to(camera.position, { x: -65, z: -72, duration: 0.85 }, 9.15)
      .to(dirLight.position, { x: -100, y: 5, z: -100, duration: 0.85 }, 9.15) // Sunset angle
      .to(dirLight, { intensity: 1.5, duration: 0.85 }, 9.15)
      .to(skyColor, { r: sunsetColor.r, g: sunsetColor.g, b: sunsetColor.b, duration: 0.85,
            onUpdate: () => { 
                scene.background.setRGB(skyColor.r, skyColor.g, skyColor.b); 
                scene.fog.color.setRGB(skyColor.r, skyColor.g, skyColor.b);
            }
      }, 9.15);
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
                document.getElementById('break-hint').innerHTML = "All skills revealed! Keep scrolling.";
                document.getElementById('break-hint').style.color = "#55ff55";
                isScrollLocked = false;
                if (lenisInstance) {
                    lenisInstance.start();
                }
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
}

let targetProgress = 0;
let currentProgress = 0;

function updateUI(t) {
    // UI Visibility for Skills (Rest at 3.19 to 4.26)
    const uiWrapper = document.getElementById('skills-ui-wrapper');
    if (uiWrapper) {
        let skillsOpacity = 0;
        if (t >= 3.0 && t < 3.9) {
            if (t < 3.3) {
                skillsOpacity = (t - 3.0) / 0.3; // Fade in
            } else if (t > 3.5) {
                skillsOpacity = 1 - (t - 3.5) / 0.4; // Fade out
            } else {
                skillsOpacity = 1;
            }
        }
        
        skillsOpacity = Math.round(skillsOpacity * 100) / 100;
        
        const currentOpacity = parseFloat(uiWrapper.style.opacity) || 0;
        if (Math.abs(currentOpacity - skillsOpacity) > 0.01) {
            uiWrapper.style.opacity = skillsOpacity;
            
            const showAxe = skillsOpacity > 0.1;
            uiWrapper.style.pointerEvents = showAxe ? 'auto' : 'none';
            
            const customCursor = document.getElementById('custom-axe-cursor');
            if (showAxe) {
                document.body.classList.add('axe-cursor');
                if (customCursor) customCursor.style.display = 'block';
                isAxeEquipped = true;
            } else {
                document.body.classList.remove('axe-cursor');
                if (customCursor) customCursor.style.display = 'none';
                isAxeEquipped = false;
            }
        }
    }

    // Hide the 'services' HTML section to prevent overlap with the fixed Skills UI
    const servicesSec = document.getElementById('services');
    if (servicesSec) {
        if (t > 3.2) {
            servicesSec.style.opacity = '0';
            servicesSec.style.pointerEvents = 'none';
        } else {
            servicesSec.style.opacity = '1';
            servicesSec.style.pointerEvents = 'auto';
        }
    }

    // UI Visibility for Projects header (Rest at 4.26 -> 7.45)
    const projectsWrapper = document.getElementById('projects-ui-wrapper');
    if (projectsWrapper) {
        if (t >= 4.2 && t < 7.6) { 
            if (projectsWrapper.style.opacity !== '1') {
                projectsWrapper.style.opacity = '1';
            }
        } else {
            if (projectsWrapper.style.opacity !== '0') {
                projectsWrapper.style.opacity = '0';
            }
        }
    }

    // Experience section appears at its new window (7.6 -> 9.2)
    const expSection = document.getElementById('experience');
    if (expSection) {
        if (t >= 7.6 && t < 9.2) {
            expSection.style.opacity = '1';
            expSection.style.pointerEvents = 'auto';
        } else {
            expSection.style.opacity = '0';
            expSection.style.pointerEvents = 'none';
        }
    }

    // Contact section appears when camera reaches the Contact 3D zone (t >= 9.0)
    const contactSection = document.getElementById('contact');
    if (contactSection) {
        if (t >= 9.0) {
            contactSection.style.opacity = '1';
            contactSection.style.pointerEvents = 'auto';
        } else {
            contactSection.style.opacity = '0';
            contactSection.style.pointerEvents = 'none';
        }
    }

    // Chatbot Dynamic Theme Switching based on scroll time 't'
    const chatbotContainer = document.getElementById('minecraft-chatbot-container');
    if (chatbotContainer) {
        let activeTheme = 'theme-overworld';
        if (t < 3.1) {
            activeTheme = 'theme-overworld';
        } else if (t >= 3.1 && t < 4.2) {
            activeTheme = 'theme-skills';
        } else if (t >= 4.2 && t < 7.6) {
            activeTheme = 'theme-projects';
        } else if (t >= 7.6 && t < 9.0) {
            activeTheme = 'theme-experience';
        } else {
            activeTheme = 'theme-contact';
        }

        if (!chatbotContainer.classList.contains(activeTheme)) {
            chatbotContainer.classList.remove(
                'theme-overworld',
                'theme-skills',
                'theme-projects',
                'theme-experience',
                'theme-contact'
            );
            chatbotContainer.classList.add(activeTheme);
        }
    }
}

/* ==========================================================================
   LENIS SMOOTH SCROLL
   ========================================================================== */
let lenisInstance = null;

function initLenis() {
    if (typeof Lenis === 'undefined') return;
    lenisInstance = new Lenis({
        duration: 0.6,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1.5,
        touchMultiplier: 2,
        infinite: false,
    });
    // Feed Lenis into RAF so it doesn't conflict with Three.js loop
    function onLenisRaf(time) {
        if (lenisInstance) lenisInstance.raf(time);
        requestAnimationFrame(onLenisRaf);
    }
    requestAnimationFrame(onLenisRaf);
}

/* ==========================================================================
   SCROLL STACK (Projects Section)
   ========================================================================== */
let stackCards = [];
let stackSectionTop = 0;
let stackSectionHeight = 0;
let cardOffsets = [];
let stackEndTop = 0;

function initScrollStack() {
    stackCards = Array.from(document.querySelectorAll('.scroll-stack-card'));
    if (!stackCards.length) return;
    
    const isMobile = window.innerWidth <= 768;
    const cardTopOffset = isMobile ? '8vh' : '20vh';
    const cardSpacing = isMobile ? 12 : 30;

    // Configure default transform-origin and style as requested by React component
    stackCards.forEach((card, i) => {
        card.style.willChange = 'transform, filter';
        card.style.transformOrigin = 'top center';
        card.style.backfaceVisibility = 'hidden';
        card.style.transform = 'translateZ(0)';
        card.style.perspective = '1000px';
        card.style.top = `calc(${cardTopOffset} + ${i * cardSpacing}px)`;
    });

    cacheScrollStackPositions();
    // updateScrollStack is run inside animate() render loop every frame for smooth lerped sync,
    // so we do not bind it to scroll event to prevent double-updating/vibration.
    updateScrollStack();
}

function cacheScrollStackPositions() {
    const container = document.getElementById('projects');
    if (!container) return;

    // Reset card styles to get correct original offsets relative to document top
    stackCards.forEach(card => {
        card.style.transform = '';
        card.style.filter = '';
    });

    // Skills ends at exactly 400vh, so Projects starts exactly at 400vh
    stackSectionTop = 4.0 * window.innerHeight;
    stackSectionHeight = container.offsetHeight || (3.4 * window.innerHeight);

    cardOffsets = stackCards.map(card => {
        // card.offsetTop is the relative offset from the projects container top
        return stackSectionTop + card.offsetTop;
    });

    const endElement = document.querySelector('.scroll-stack-end');
    if (endElement) {
        stackEndTop = stackSectionTop + endElement.offsetTop;
    }
}

function updateScrollStack() {
    if (!stackCards.length || !cardOffsets.length) return;

    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const scrollTop = currentProgress * maxScroll;
    const containerHeight = window.innerHeight;
    const isMobile = window.innerWidth <= 768;

    // Parameters matching the React component config:
    // stackPosition = 20% (8% for mobile), scaleEndPosition = 10% (4% for mobile)
    const stackPositionPx = (isMobile ? 0.08 : 0.20) * containerHeight;
    const scaleEndPositionPx = (isMobile ? 0.04 : 0.10) * containerHeight;
    const itemStackDistance = isMobile ? 12 : 30;
    const baseScale = 0.85;
    const itemScale = 0.03;

    const sectionScrolled = scrollTop - stackSectionTop;

    stackCards.forEach((card, i) => {
        const cardTop = cardOffsets[i];
        
        // Hide cards completely if scroll is above the start of the projects section
        if (scrollTop < stackSectionTop) {
            card.style.opacity = 0;
            card.style.transform = 'scale(1)';
            card.style.pointerEvents = 'none';
            card.classList.remove('stack-visible');
            return;
        }

        const triggerStart = cardTop - stackPositionPx - itemStackDistance * i;
        const triggerEnd = cardTop - scaleEndPositionPx;
        const pinStart = cardTop - stackPositionPx - itemStackDistance * i;
        const pinEnd = stackEndTop - containerHeight / 2;

        // Calculate progress for scaling
        let scaleProgress = 0;
        if (scrollTop > triggerStart) {
            if (scrollTop < triggerEnd) {
                scaleProgress = (scrollTop - triggerStart) / (triggerEnd - triggerStart);
            } else {
                scaleProgress = 1;
            }
        }
        
        const targetScale = baseScale + i * itemScale;
        const scale = 1 - scaleProgress * (1 - targetScale);

        // Apply scale transform continuously for depth stack effect, pinning is handled natively by CSS sticky top
        card.style.transform = `scale(${scale})`;

        // Fade in Card 0 smoothly over the first 150px of entering the projects section
        let opacity = 1;
        if (i === 0) {
            const startFadeRange = 150; // 150px fade-in zone
            opacity = Math.max(0, Math.min(1, sectionScrolled / startFadeRange));
        } else {
            // Other cards fade in based on viewport visibility
            const isVisible = scrollTop > cardTop - containerHeight;
            opacity = isVisible ? 1 : 0;
        }

        card.style.opacity = opacity;
        card.style.pointerEvents = opacity > 0.1 ? 'auto' : 'none';
        card.classList.toggle('stack-visible', opacity > 0.1);
        card.style.zIndex = i;
    });
}

/* ==========================================================================
   TARGET CURSOR (Snapping Crosshair)
   ========================================================================== */
let cursorContainer = null;
let cursorDot = null;
let cursorCorners = [];
let cursorMouseX = 0, cursorMouseY = 0;
let cursorCurrentX = 0, cursorCurrentY = 0;
let cursorIdleRotation = 0;
let cursorHovering = false;
let cursorTarget = null;
let cursorIdleTimer = null;
let cursorIdleSpin = false;
const isCursorMobile = window.innerWidth <= 768;

function setupTargetCursor() {
    // The bracket effect is handled purely by CSS on .cursor-target:hover
    // No cursor hiding — default cursor always visible
    // This function is kept for future JS enhancements if needed
    if (isCursorMobile) return;
    // nothing to set up — CSS handles everything
}

function resetIdleSpin() {
    cursorIdleSpin = false;
    clearTimeout(cursorIdleTimer);
    cursorIdleTimer = setTimeout(() => {
        if (!cursorHovering) cursorIdleSpin = true;
    }, 2000);
}

function updateCursorCorners(spreadX, spreadY, w, h) {
    // Positions relative to cursor center (which is 0,0 in container)
    const offsets = [
        { x: -spreadX, y: -spreadY }, // TL
        { x:  spreadX, y: -spreadY }, // TR
        { x:  spreadX, y:  spreadY }, // BR
        { x: -spreadX, y:  spreadY }, // BL
    ];
    cursorCorners.forEach((corner, i) => {
        corner.style.width = w + 'px';
        corner.style.height = h + 'px';
        corner.style.transform = `translate(${offsets[i].x}px, ${offsets[i].y}px)`;
    });
}

let cursorAnimId = null;
function animateCursor() {
    cursorAnimId = requestAnimationFrame(animateCursor);
    if (!cursorContainer) return;

    // Smooth follow
    const lerpFactor = 0.18;
    cursorCurrentX += (cursorMouseX - cursorCurrentX) * lerpFactor;
    cursorCurrentY += (cursorMouseY - cursorCurrentY) * lerpFactor;

    cursorContainer.style.transform = `translate(${cursorCurrentX}px, ${cursorCurrentY}px)`;

    if (cursorHovering && cursorTarget) {
        // Snap corners to the target card's bounding box
        const r = cursorTarget.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const halfW = r.width / 2;
        const halfH = r.height / 2;
        const dx = cx - cursorCurrentX;
        const dy = cy - cursorCurrentY;
        const spreadX = halfW + Math.abs(dx) * 0.2;
        const spreadY = halfH + Math.abs(dy) * 0.2;
        updateCursorCorners(spreadX, spreadY, 18, 18);
        cursorContainer.style.filter = 'drop-shadow(0 0 6px #10b981)';
    } else {
        updateCursorCorners(8, 8, 12, 12);
        cursorContainer.style.filter = '';
    }

    // Idle spin
    if (cursorIdleSpin && !cursorHovering) {
        cursorIdleRotation += 0.8;
        cursorContainer.style.rotate = cursorIdleRotation + 'deg';
    } else {
        cursorIdleRotation = 0;
        cursorContainer.style.rotate = '0deg';
    }
}

function animate(timestamp) {
    requestAnimationFrame(animate);
    
    // Drive GSAP timeline progress with native scroll position (with damping for butter-smooth motion)
    if (tl) {
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        targetProgress = maxScroll > 0 ? window.scrollY / maxScroll : 0;
        
        // Lerp progress to make camera moves smooth (0.1 damping factor)
        currentProgress += (targetProgress - currentProgress) * 0.1; 
        tl.progress(currentProgress);
        
        // Run UI visibility updates
        updateUI(tl.time());
    }

    // Continuously sync scroll stack each frame for smoothness
    updateScrollStack();
    
    const time = clock.getElapsedTime();

    // Bouncing text animation
    if (clickBoxesInstruction && clickBoxesInstruction.material.opacity > 0) {
        const baseY = clickBoxesInstruction.userData.baseY || 1.0;
        clickBoxesInstruction.position.y = baseY + Math.sin(time * 4) * 0.15;
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

    renderer.render(scene, camera);
}

init();

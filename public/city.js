import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { processKey } from "./model.js";
const CAPACITY = 100,
  FRAGMENTS = 144;
const slots = Array.from({ length: CAPACITY }, (_, i) => ({
  x: ((i % 10) - 4.5) * 4.3,
  z: (Math.floor(i / 10) - 4.5) * 4.3,
})).sort((a, b) => a.x * a.x + a.z * a.z - b.x * b.x - b.z * b.z);
const palette = [0x46c4bc, 0x739ddc, 0x9c83d2, 0x3d9eae];
const hash = (text) =>
  [...text].reduce((v, c) => (v * 31 + c.charCodeAt(0)) >>> 0, 0);
function facade() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#24454f";
  ctx.fillRect(0, 0, 64, 128);
  ctx.strokeStyle = "#b0eee7";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, 63, 127);
  for (let y = 7; y < 124; y += 10)
    for (let x = 7; x < 60; x += 11) {
      ctx.fillStyle = (x + y) % 4 ? "#b6fff1" : "#365b66";
      ctx.fillRect(x, y, 3, 3);
    }
  ctx.fillStyle = "#365560";
  ctx.fillRect(0, 0, 3, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export class City {
  constructor(canvas, { onSelect, onHover, onStats }) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.onStats = onStats;
    this.buildings = new Map();
    this.slotKeys = [];
    this.fragments = [];
    this.motion = true;
    this.mode = "memory";
    this.quality = "auto";
    this.autoRotate = false;
    this.cpu = 0;
    this.memory = 0;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(0x09131a, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    const gl = this.renderer.getContext(),
      ext = gl.getExtension("WEBGL_debug_renderer_info");
    this.software =
      !!ext &&
      /swiftshader|llvmpipe|software|microsoft basic render/i.test(
        gl.getParameter(ext.UNMASKED_RENDERER_WEBGL),
      );
    this.autoRatio = this.software ? 0.6 : Math.min(devicePixelRatio, 1.4);
    this.applyQuality();
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0b202a, 0.012);
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 250);
    this.camera.position.set(43, 42, 48);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.8, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 13;
    this.controls.maxDistance = 90;
    this.controls.maxPolarAngle = Math.PI / 2.13;
    this.controls.enablePan = false;
    this.controls.addEventListener("start", () => {
      this.flight = null;
    });
    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(48, 0.5, 48),
      new THREE.MeshBasicMaterial({ color: 0x10252e }),
    );
    ground.position.y = -0.3;
    this.ground = ground;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(48, 16, 0x386370, 0x1d3c47);
    grid.position.y = -0.02;
    this.scene.add(grid);
    const streets = [];
    for (let n = -24; n <= 24; n += 6)
      streets.push(-24, 0.02, n, 24, 0.02, n, n, 0.02, -24, n, 0.02, 24);
    this.scene.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(streets, 3),
        ),
        new THREE.LineBasicMaterial({
          color: 0x398a8b,
          transparent: true,
          opacity: 0.55,
        }),
      ),
    );
    const geometry = new THREE.BoxGeometry(2.4, 1, 2.4);
    // The roof/floor use a quiet texel; the facade retains its window pattern.
    const uv = geometry.attributes.uv;
    for (let i = 8; i < 16; i++) uv.setXY(i, 0.015, 0.007);
    const normal = geometry.attributes.normal,
      shades = new Float32Array(normal.count * 3);
    for (let i = 0; i < normal.count; i++) {
      const shade =
        0.74 +
        normal.getX(i) * 0.13 +
        normal.getY(i) * 0.2 +
        normal.getZ(i) * 0.06;
      shades.set([shade, shade, shade], i * 3);
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(shades, 3));
    this.towers = new THREE.InstancedMesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: facade(),
        color: 0xffffff,
        vertexColors: true,
      }),
      CAPACITY,
    );
    this.towers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.towers.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 10, 0),
      46,
    );
    this.scene.add(this.towers);
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    for (let i = 0; i < CAPACITY; i++) this.hideSlot(i);
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({ color: 0xd5fff6 }),
    );
    this.outline.visible = false;
    this.scene.add(this.outline);
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(1.8, 1.88, 40),
      new THREE.MeshBasicMaterial({
        color: 0x9fffea,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
    this.debrisMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.4, 0.5, 0.4),
      new THREE.MeshBasicMaterial({
        color: 0x89ddd5,
        transparent: true,
        opacity: 0.8,
      }),
      FRAGMENTS,
    );
    this.debrisMesh.count = 0;
    this.debrisMesh.frustumCulled = false;
    this.scene.add(this.debrisMesh);
    this.people = Array.from({ length: 120 }, (_, i) => ({
      x: ((i * 7.13) % 48) - 24,
      z: ((i * 13.7) % 48) - 24,
      axis: i % 2,
      speed: (i % 3 ? 1 : -1) * 0.65,
    }));
    this.citizens = new THREE.Points(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(new Float32Array(360), 3),
      ),
      new THREE.PointsMaterial({
        color: 0xabe8e0,
        size: 0.12,
        transparent: true,
        opacity: 0.75,
      }),
    );
    this.scene.add(this.citizens);
    const stars = Array.from({ length: 210 }, (_, i) => [
      Math.sin(i * 1.63) * 48,
      5 + ((i * 2.7) % 32),
      Math.cos(i * 3.1) * 48,
    ]).flat();
    this.scene.add(
      new THREE.Points(
        new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(stars, 3),
        ),
        new THREE.PointsMaterial({
          color: 0x7ca9bb,
          size: 0.06,
          transparent: true,
          opacity: 0.45,
        }),
      ),
    );
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    const pick = (event) => {
      const rect = canvas.getBoundingClientRect();
      this.pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      this.ray.setFromCamera(this.pointer, this.camera);
      const hit = this.ray.intersectObject(this.towers)[0];
      return hit ? this.buildings.get(this.slotKeys[hit.instanceId]) : null;
    };
    let down;
    canvas.addEventListener("pointerdown", (e) => {
      down = [e.clientX, e.clientY];
    });
    canvas.addEventListener("pointerup", (e) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) {
        const b = pick(e);
        this.onSelect(b?.process || null);
      }
    });
    canvas.addEventListener("dblclick", (e) => {
      const b = pick(e);
      if (b) {
        this.onSelect(b.process);
        this.focus(processKey(b.process));
      }
    });
    let lastHover = 0;
    canvas.addEventListener("pointermove", (e) => {
      if (e.buttons || performance.now() - lastHover < 85) return;
      lastHover = performance.now();
      const b = pick(e);
      canvas.style.cursor = b ? "pointer" : "grab";
      this.onHover(b?.process, e);
    });
    canvas.addEventListener("pointerleave", () => this.onHover(null));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.frames = 0;
    this.statsTime = performance.now();
    this.lastFrame = performance.now();
    this.lowWindows = 0;
    this.highWindows = 0;
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
  }
  applyQuality() {
    const ratio =
      this.quality === "smooth"
        ? this.software
          ? 0.5
          : 1
        : this.quality === "sharp"
          ? Math.min(devicePixelRatio, this.software ? 1 : 1.75)
          : this.autoRatio;
    this.targetFPS = this.software ? (this.quality === "sharp" ? 20 : 30) : 60;
    this.renderer.setPixelRatio(ratio);
    if (this.camera) this.resize();
  }
  setQuality(value) {
    this.quality = value;
    this.applyQuality();
  }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }
  hideSlot(slot) {
    this.dummy.position.set(0, -20, 0);
    this.dummy.scale.set(0, 0, 0);
    this.dummy.updateMatrix();
    this.towers.setMatrixAt(slot, this.dummy.matrix);
    this.towers.instanceMatrix.needsUpdate = true;
    this.slotKeys[slot] = null;
  }
  paint(b) {
    const hot = b.process.cpu;
    let color =
      hot > 75 ? 0xffa567 : palette[hash(b.process.name) % palette.length];
    if (this.mode === "cpu")
      this.color.setHSL(0.48 - Math.min(hot / 120, 1) * 0.4, 0.65, 0.46);
    else this.color.setHex(color);
    if (b.key === this.selected)
      this.color.lerp(new THREE.Color(0xd9fff0), 0.4);
    this.towers.setColorAt(b.slot, this.color);
    this.towers.instanceColor.needsUpdate = true;
  }
  update(processes, { cpu, memory, mode, selected }) {
    this.cpu = cpu;
    this.memory = memory;
    this.mode = mode;
    this.selected = selected;
    const all = new Set(processes.map(processKey));
    const sorted = [...processes].sort((a, b) => b[mode] - a[mode]);
    const visible = sorted.slice(0, CAPACITY);
    const chosen = processes.find((p) => processKey(p) === selected);
    if (chosen && !visible.includes(chosen)) {
      if (visible.length === CAPACITY) visible.pop();
      visible.push(chosen);
    }
    const keys = new Set(visible.map(processKey));
    let explosions = 0;
    for (const [key, b] of this.buildings)
      if (!keys.has(key)) {
        if (!all.has(key) && explosions++ < 3 && this.motion) this.explode(b);
        this.hideSlot(b.slot);
        this.buildings.delete(key);
      }
    for (const p of visible) {
      const key = processKey(p);
      let b = this.buildings.get(key);
      if (!b) {
        const slot = this.slotKeys.findIndex((k) => !k);
        if (slot < 0) continue;
        b = { key, slot, height: 0.1, process: p };
        this.slotKeys[slot] = key;
        this.buildings.set(key, b);
      }
      b.process = p;
      b.target =
        mode === "cpu"
          ? Math.max(0.65, Math.min(20, Math.log2(1 + p.cpu) * 2.4))
          : Math.max(0.65, Math.min(20, Math.sqrt(p.memory / 1048576) * 0.85));
      this.paint(b);
    }
  }
  select(key) {
    this.selected = key;
    for (const b of this.buildings.values()) this.paint(b);
  }
  focus(key) {
    const b = this.buildings.get(key);
    if (!b) return false;
    const p = slots[b.slot],
      target = new THREE.Vector3(p.x, Math.min(b.target / 2, 9), p.z);
    this.flight = {
      target,
      position: target.clone().add(new THREE.Vector3(13, 12, 16)),
    };
    return true;
  }
  home() {
    this.flight = {
      target: new THREE.Vector3(0, 0.8, 0),
      position: new THREE.Vector3(43, 42, 48),
    };
  }
  explode(b) {
    this.panicUntil = performance.now() + 1800;
    const p = slots[b.slot];
    for (let i = 0; i < 16 && this.fragments.length < FRAGMENTS; i++)
      this.fragments.push({
        x: p.x,
        z: p.z,
        y: Math.random() * b.height,
        vx: (Math.random() - 0.5) * 8,
        vz: (Math.random() - 0.5) * 8,
        vy: Math.random() * 6,
        life: 1.6,
        rotation: Math.random(),
      });
  }
  animate(now) {
    this.frame = requestAnimationFrame(this.animate);
    if (document.hidden) {
      this.lastFrame = now;
      return;
    }
    if (now - this.lastFrame < 1000 / this.targetFPS - 1) return;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    if (this.flight) {
      const a = 1 - Math.exp(-dt * 7);
      this.camera.position.lerp(this.flight.position, a);
      this.controls.target.lerp(this.flight.target, a);
      if (this.camera.position.distanceTo(this.flight.position) < 0.03)
        this.flight = null;
    }
    this.controls.autoRotate = this.autoRotate && this.motion;
    this.controls.autoRotateSpeed = 0.4;
    this.controls.dampingFactor = 1 - Math.exp(-dt * 12);
    this.controls.update(dt);
    let changed = false;
    for (const b of this.buildings.values()) {
      if (Math.abs(b.height - b.target) > 0.002) {
        b.height = THREE.MathUtils.damp(b.height, b.target, 9, dt);
        const p = slots[b.slot];
        this.dummy.position.set(p.x, b.height / 2, p.z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(1, b.height, 1);
        this.dummy.updateMatrix();
        this.towers.setMatrixAt(b.slot, this.dummy.matrix);
        changed = true;
      }
    }
    if (changed) this.towers.instanceMatrix.needsUpdate = true;
    const active = this.buildings.get(this.selected);
    this.outline.visible = this.ring.visible = !!active;
    if (active) {
      const p = slots[active.slot];
      this.outline.position.set(p.x, active.height / 2, p.z);
      this.outline.scale.set(1.02, active.height + 0.03, 1.02);
      this.ring.position.set(p.x, 0.04, p.z);
    }
    const people = this.citizens.geometry.attributes.position;
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      if (this.motion)
        p[p.axis ? "z" : "x"] += p.speed * dt * (now < this.panicUntil ? 4 : 1);
      if (p.x > 24) p.x = -24;
      if (p.x < -24) p.x = 24;
      if (p.z > 24) p.z = -24;
      if (p.z < -24) p.z = 24;
      people.setXYZ(
        i,
        p.axis ? Math.round(p.x / 6) * 6 : p.x,
        0.14,
        p.axis ? p.z : Math.round(p.z / 6) * 6,
      );
    }
    if (this.motion || !this.peopleInitialized) {
      people.needsUpdate = true;
      this.peopleInitialized = true;
    }
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const f = this.fragments[i];
      f.life -= dt;
      if (f.life <= 0) {
        this.fragments.splice(i, 1);
        continue;
      }
      f.x += f.vx * dt;
      f.z += f.vz * dt;
      f.y = Math.max(0.1, f.y + f.vy * dt);
      f.vy -= 15 * dt;
      f.rotation += dt * 2;
    }
    this.debrisMesh.count = this.fragments.length;
    this.fragments.forEach((f, i) => {
      this.dummy.position.set(f.x, f.y, f.z);
      this.dummy.rotation.set(f.rotation, 0, f.rotation);
      this.dummy.scale.setScalar(Math.min(1, f.life));
      this.dummy.updateMatrix();
      this.debrisMesh.setMatrixAt(i, this.dummy.matrix);
    });
    if (this.fragments.length)
      this.debrisMesh.instanceMatrix.needsUpdate = true;
    this.ground.position.y =
      this.motion && this.cpu > 80
        ? -0.3 + Math.sin(now * 0.025) * 0.025
        : -0.3;
    this.scene.fog.density = THREE.MathUtils.damp(
      this.scene.fog.density,
      this.memory > 85 ? 0.021 : 0.012,
      2,
      dt,
    );
    this.renderer.render(this.scene, this.camera);
    this.frames++;
    if (now - this.statsTime >= 1000) {
      const fps = Math.round((this.frames * 1000) / (now - this.statsTime));
      const stats = {
        fps,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
        buildings: this.buildings.size,
        pixelRatio: this.renderer.getPixelRatio(),
        software: this.software,
        cameraDistance: this.camera.position.distanceTo(this.controls.target),
      };
      this.onStats(stats);
      this.frames = 0;
      this.statsTime = now;
      if (this.quality === "auto") {
        const min = this.software ? 0.45 : 0.75,
          max = this.software ? 0.8 : Math.min(devicePixelRatio, 1.4),
          step = this.software ? 0.05 : 0.15;
        this.lowWindows = fps < this.targetFPS * 0.7 ? this.lowWindows + 1 : 0;
        this.highWindows =
          fps > this.targetFPS * 0.92 ? this.highWindows + 1 : 0;
        if (this.lowWindows >= 3 && this.autoRatio > min) {
          this.autoRatio = Math.max(min, this.autoRatio - step);
          this.lowWindows = 0;
          this.applyQuality();
        }
        if (this.highWindows >= 8 && this.autoRatio < max) {
          this.autoRatio = Math.min(max, this.autoRatio + step);
          this.highWindows = 0;
          this.applyQuality();
        }
      }
    }
  }
  destroy() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    this.renderer.dispose();
  }
}

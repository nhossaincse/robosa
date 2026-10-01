import * as THREE from 'three';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import {
  analyzeAvatarRig,
  canonicalViseme,
  createMorphBinding,
  morphValuesForViseme,
  VRM_MOUTH_EXPRESSIONS,
  vrmValuesForViseme,
} from './avatarRig.js';

const VISEME_VALUES = Object.freeze({
  sil: { open: 0.02, wide: 1 },
  PP: { open: 0.01, wide: 1.04 },
  FF: { open: 0.09, wide: 1.08 },
  TH: { open: 0.17, wide: 1.02 },
  DD: { open: 0.13, wide: 1.06 },
  kk: { open: 0.22, wide: 1.02 },
  CH: { open: 0.17, wide: 1.08 },
  SS: { open: 0.07, wide: 1.17 },
  nn: { open: 0.1, wide: 1.07 },
  RR: { open: 0.17, wide: 0.91 },
  aa: { open: 0.44, wide: 1.08 },
  E: { open: 0.24, wide: 1.2 },
  I: { open: 0.17, wide: 1.18 },
  O: { open: 0.34, wide: 0.72 },
  U: { open: 0.2, wide: 0.68 },
});

function material(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness: options.metalness ?? 0.18,
    roughness: options.roughness ?? 0.42,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
  });
}

function mesh(geometry, meshMaterial, position = [0, 0, 0]) {
  const value = new THREE.Mesh(geometry, meshMaterial);
  value.position.set(...position);
  value.castShadow = true;
  value.receiveShadow = true;
  return value;
}

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.filter(Boolean).forEach((item) => {
      item.map?.dispose?.();
      item.dispose?.();
    });
  });
}

export class Twin3DStage {
  constructor(
    container,
    { modelUrl = '', onModelError = () => {}, onModelReady = () => {} } = {},
  ) {
    this.container = container;
    this.onModelError = onModelError;
    this.onModelReady = onModelReady;
    this.clock = new THREE.Clock();
    this.pointer = new THREE.Vector2();
    this.pointerTarget = new THREE.Vector2();
    this.speaking = false;
    this.viseme = 'sil';
    this.visemeStrength = 0;
    this.visemeWeights = new Map();
    this.morphMeshes = [];
    this.vrm = null;
    this.disposed = false;
    this.frame = 0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xe9eeeb, 5.5, 10);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.set(0, 0.1, 5.8);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.3;
    this.controls.maxDistance = 7.2;
    this.controls.minPolarAngle = Math.PI * 0.34;
    this.controls.maxPolarAngle = Math.PI * 0.64;
    this.controls.target.set(0, 0.05, 0);

    this.scene.add(new THREE.HemisphereLight(0xf7fbff, 0x667166, 2.4));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
    keyLight.position.set(3.2, 4.5, 4.2);
    keyLight.castShadow = true;
    this.scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x6c8cff, 2.1);
    rimLight.position.set(-4, 2.2, -1.5);
    this.scene.add(rimLight);
    const greenLight = new THREE.PointLight(0xb9ed4a, 4, 7);
    greenLight.position.set(2.6, -1.2, 2.2);
    this.scene.add(greenLight);

    this.avatarRoot = new THREE.Group();
    this.scene.add(this.avatarRoot);
    this.buildProceduralAvatar();

    const floor = mesh(
      new THREE.CircleGeometry(2.6, 64),
      new THREE.MeshStandardMaterial({
        color: 0xdfe6e1,
        roughness: 0.9,
        transparent: true,
        opacity: 0.72,
      }),
      [0, -2.05, 0],
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this.onPointerMove = (event) => {
      const rect = this.container.getBoundingClientRect();
      this.pointerTarget.set(
        ((event.clientX - rect.left) / rect.width - 0.5) * 2,
        ((event.clientY - rect.top) / rect.height - 0.5) * 2,
      );
    };
    this.onPointerLeave = () => this.pointerTarget.set(0, 0);
    container.addEventListener('pointermove', this.onPointerMove);
    container.addEventListener('pointerleave', this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    if (modelUrl) this.loadModel(modelUrl);
    this.animate();
  }

  buildProceduralAvatar() {
    const white = material(0xe9edee, { metalness: 0.52, roughness: 0.24 });
    const graphite = material(0x1c2228, { metalness: 0.72, roughness: 0.3 });
    const joint = material(0x75808b, { metalness: 0.82, roughness: 0.2 });
    const blue = material(0x2759dd, {
      metalness: 0.25,
      roughness: 0.24,
      emissive: 0x214cbf,
      emissiveIntensity: 2.2,
    });
    const green = material(0xb9ed4a, {
      roughness: 0.28,
      emissive: 0x7ba92b,
      emissiveIntensity: 1.2,
    });

    this.body = new THREE.Group();
    this.avatarRoot.add(this.body);
    const torso = mesh(
      new THREE.CapsuleGeometry(0.96, 1.15, 8, 24),
      white,
      [0, -1.35, 0],
    );
    torso.scale.set(1.28, 1, 0.62);
    this.body.add(torso);
    const chest = mesh(
      new THREE.SphereGeometry(0.78, 32, 20),
      graphite,
      [0, -1.03, 0.5],
    );
    chest.scale.set(1.15, 0.54, 0.24);
    this.body.add(chest);
    this.body.add(
      mesh(
        new THREE.TorusGeometry(0.34, 0.045, 12, 48),
        green,
        [0, -0.96, 0.71],
      ),
    );

    for (const side of [-1, 1]) {
      const shoulder = mesh(new THREE.SphereGeometry(0.45, 24, 16), white, [
        side * 1.12,
        -1.12,
        0,
      ]);
      shoulder.scale.set(1.2, 0.82, 0.9);
      this.body.add(shoulder);
      const neckCable = mesh(
        new THREE.CylinderGeometry(0.055, 0.075, 0.7, 10),
        blue,
        [side * 0.34, -0.43, 0.02],
      );
      neckCable.rotation.z = side * -0.3;
      this.body.add(neckCable);
    }

    this.neck = mesh(
      new THREE.CylinderGeometry(0.42, 0.52, 0.64, 24),
      joint,
      [0, -0.38, 0],
    );
    this.body.add(this.neck);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.42, 0);
    this.body.add(this.head);

    const skull = mesh(new THREE.SphereGeometry(0.87, 48, 32), white);
    skull.scale.set(0.78, 0.98, 0.78);
    this.head.add(skull);
    const crown = mesh(
      new THREE.SphereGeometry(0.76, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.48),
      graphite,
      [0, 0.14, -0.03],
    );
    crown.scale.set(0.86, 1.08, 0.79);
    this.head.add(crown);

    for (const side of [-1, 1]) {
      const ear = mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 0.16, 24),
        graphite,
        [side * 0.76, 0.02, 0],
      );
      ear.rotation.z = Math.PI / 2;
      this.head.add(ear);
      const earLight = mesh(new THREE.TorusGeometry(0.16, 0.04, 10, 30), blue, [
        side * 0.85,
        0.02,
        0,
      ]);
      earLight.rotation.y = Math.PI / 2;
      this.head.add(earLight);
    }

    this.facePanel = mesh(
      new THREE.CircleGeometry(0.67, 64),
      material(0xcfd8da, { metalness: 0.08, roughness: 0.5 }),
      [0, 0.04, 0.68],
    );
    this.facePanel.scale.set(0.79, 0.98, 1);
    this.head.add(this.facePanel);

    this.eyes = [];
    this.lids = [];
    for (const side of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.12, 24, 16), blue, [
        side * 0.26,
        0.18,
        0.735,
      ]);
      eye.scale.set(1.2, 0.64, 0.42);
      this.head.add(eye);
      this.eyes.push(eye);
      const lid = mesh(new THREE.SphereGeometry(0.135, 24, 12), graphite, [
        side * 0.26,
        0.205,
        0.75,
      ]);
      lid.scale.set(1.25, 0.08, 0.45);
      this.head.add(lid);
      this.lids.push(lid);
    }

    this.mouth = new THREE.Group();
    this.mouth.position.set(0, -0.27, 0.755);
    this.head.add(this.mouth);
    this.mouthBack = mesh(
      new THREE.CapsuleGeometry(0.07, 0.28, 6, 16),
      graphite,
    );
    this.mouthBack.rotation.z = Math.PI / 2;
    this.mouthBack.scale.set(1, 1, 0.35);
    this.mouth.add(this.mouthBack);
    this.lowerLip = mesh(
      new THREE.CapsuleGeometry(0.026, 0.24, 5, 14),
      green,
      [0, -0.055, 0.025],
    );
    this.lowerLip.rotation.z = Math.PI / 2;
    this.mouth.add(this.lowerLip);
  }

  async loadModel(url) {
    try {
      const loader = new GLTFLoader();
      loader.register((parser) => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url);
      if (this.disposed) return disposeObject(gltf.scene);
      disposeObject(this.avatarRoot);
      this.scene.remove(this.avatarRoot);
      this.vrm = gltf.userData.vrm || null;
      if (this.vrm) VRMUtils.rotateVRM0(this.vrm);
      this.avatarRoot = this.vrm?.scene || gltf.scene;
      this.scene.add(this.avatarRoot);
      this.body = null;
      this.head = null;
      this.mouth = null;
      this.lids = [];

      const box = new THREE.Box3().setFromObject(this.avatarRoot);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = 3.7 / Math.max(size.y, 0.001);
      this.avatarRoot.scale.setScalar(scale);
      this.avatarRoot.position.set(
        -center.x * scale,
        -center.y * scale - 0.12,
        -center.z * scale,
      );
      this.morphMeshes = [];
      let skinnedMeshes = 0;
      this.avatarRoot.traverse((child) => {
        if (!child.isMesh) return;
        if (child.isSkinnedMesh) skinnedMeshes += 1;
        child.castShadow = true;
        child.receiveShadow = true;
        if (child.morphTargetDictionary && child.morphTargetInfluences) {
          this.morphMeshes.push({
            mesh: child,
            binding: createMorphBinding(child.morphTargetDictionary),
          });
        }
      });
      if (gltf.animations.length) {
        this.mixer = new THREE.AnimationMixer(this.avatarRoot);
        const idle =
          THREE.AnimationClip.findByName(gltf.animations, 'Idle') ||
          gltf.animations[0];
        this.mixer.clipAction(idle).play();
      }
      const expressionNames = Object.keys(
        this.vrm?.expressionManager?.expressionMap || {},
      );
      this.onModelReady({
        ...analyzeAvatarRig(
          this.morphMeshes.map((entry) => entry.binding),
          { vrmExpressions: expressionNames, skinnedMeshes },
        ),
        format: this.vrm ? 'vrm' : 'glb',
      });
    } catch {
      this.onModelError(
        'The 3D model could not be loaded. Using the demo character.',
      );
    }
  }

  setSpeaking(value) {
    this.speaking = Boolean(value);
    if (!this.speaking) this.setViseme('sil', 0);
  }

  setViseme(name, strength = 1) {
    this.viseme = canonicalViseme(name);
    this.visemeStrength = THREE.MathUtils.clamp(strength, 0, 1);
    this.visemeWeights.clear();
    if (this.visemeStrength > 0) {
      this.visemeWeights.set(this.viseme, this.visemeStrength);
    }
  }

  setVisemeValue(name, strength = 1) {
    const viseme = canonicalViseme(name);
    const value = THREE.MathUtils.clamp(strength, 0, 1);
    if (value < 0.001) this.visemeWeights.delete(viseme);
    else this.visemeWeights.set(viseme, value);
    let dominant = ['sil', 0];
    for (const entry of this.visemeWeights) {
      if (entry[1] > dominant[1]) dominant = entry;
    }
    this.viseme = dominant[0];
    this.visemeStrength = dominant[1];
  }

  async previewLipSync() {
    this.setSpeaking(true);
    for (const viseme of ['PP', 'FF', 'TH', 'aa', 'E', 'I', 'O', 'U']) {
      if (this.disposed) return;
      this.setViseme(viseme, 0.95);
      await new Promise((resolve) => globalThis.setTimeout(resolve, 180));
    }
    this.setSpeaking(false);
  }

  resetCamera() {
    this.camera.position.set(0, 0.1, 5.8);
    this.controls.target.set(0, 0.05, 0);
    this.controls.update();
  }

  resize() {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  animate = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.animate);
    const delta = this.clock.getDelta();
    const elapsed = this.clock.elapsedTime;
    this.pointer.lerp(this.pointerTarget, 0.045);

    if (this.head) {
      this.head.rotation.y = this.pointer.x * 0.2;
      this.head.rotation.x = this.pointer.y * 0.1;
    }
    if (this.body) {
      this.body.position.y = Math.sin(elapsed * 1.2) * 0.025;
      this.body.rotation.z = Math.sin(elapsed * 0.48) * 0.012;
    }

    const blinkCycle = elapsed % 4.6;
    const blink =
      blinkCycle > 4.42 ? Math.sin(((blinkCycle - 4.42) / 0.18) * Math.PI) : 0;
    this.lids?.forEach((lid) => {
      lid.scale.y = 0.08 + blink * 4.8;
    });

    const target = VISEME_VALUES[this.viseme] || VISEME_VALUES.sil;
    const pulse = this.speaking ? 0.92 + Math.sin(elapsed * 19) * 0.08 : 1;
    const open = THREE.MathUtils.lerp(
      VISEME_VALUES.sil.open,
      target.open * pulse,
      this.visemeStrength,
    );
    if (this.mouth) {
      this.mouth.scale.x = THREE.MathUtils.lerp(
        this.mouth.scale.x,
        target.wide,
        0.22,
      );
      this.mouthBack.scale.y = THREE.MathUtils.lerp(
        this.mouthBack.scale.y,
        1 + open * 5.6,
        0.24,
      );
      this.lowerLip.position.y = THREE.MathUtils.lerp(
        this.lowerLip.position.y,
        -0.055 - open * 0.28,
        0.24,
      );
    }

    this.mixer?.update(delta);
    const expressionManager = this.vrm?.expressionManager;
    if (expressionManager) {
      const values = Object.fromEntries(
        VRM_MOUTH_EXPRESSIONS.map((name) => [name, 0]),
      );
      for (const [viseme, strength] of this.visemeWeights) {
        const next = vrmValuesForViseme(viseme, strength);
        for (const name of VRM_MOUTH_EXPRESSIONS) {
          values[name] = Math.max(values[name], next[name]);
        }
      }
      for (const name of VRM_MOUTH_EXPRESSIONS) {
        if (expressionManager.getExpression(name)) {
          expressionManager.setValue(name, values[name]);
        }
      }
      if (expressionManager.getExpression('blink')) {
        expressionManager.setValue('blink', blink);
      } else {
        if (expressionManager.getExpression('blinkLeft')) {
          expressionManager.setValue('blinkLeft', blink);
        }
        if (expressionManager.getExpression('blinkRight')) {
          expressionManager.setValue('blinkRight', blink);
        }
      }
    }
    this.vrm?.update(delta);

    this.morphMeshes.forEach((entry) => {
      const desired = new Map();
      for (const [viseme, strength] of this.visemeWeights) {
        for (const [index, value] of morphValuesForViseme(
          entry.binding,
          viseme,
          strength,
        )) {
          desired.set(index, Math.max(desired.get(index) || 0, value));
        }
      }
      for (const index of entry.binding.mouthIndices) {
        const current = entry.mesh.morphTargetInfluences[index] || 0;
        entry.mesh.morphTargetInfluences[index] = THREE.MathUtils.lerp(
          current,
          desired.get(index) || 0,
          0.34,
        );
      }
      const left =
        entry.binding.blinkLeft >= 0
          ? entry.binding.blinkLeft
          : entry.binding.blink;
      const right =
        entry.binding.blinkRight >= 0
          ? entry.binding.blinkRight
          : entry.binding.blink;
      if (left >= 0) entry.mesh.morphTargetInfluences[left] = blink;
      if (right >= 0) entry.mesh.morphTargetInfluences[right] = blink;
    });

    this.controls.update(delta);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.container.removeEventListener('pointermove', this.onPointerMove);
    this.container.removeEventListener('pointerleave', this.onPointerLeave);
    this.controls.dispose();
    this.mixer?.stopAllAction();
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

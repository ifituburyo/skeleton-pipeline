/**
 * Camera-aligned AR overlay (FR-09, FR-10). An orthographic camera maps the scene
 * 1:1 onto the displayed video: x ∈ [0, aspect], y ∈ [0, 1].
 */
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AnatomyPose } from '../anatomy/rigMapping';
import { PipelineError } from '../types/pose';
import { SkeletonModel, type LayerVisibility } from './SkeletonModel';
import type { RenderStyle } from './materials';

export interface Alignment {
  /** Uniform scale around the pelvis (1 = as estimated). */
  scale: number;
  /** Offsets as a fraction of frame height. */
  offsetX: number;
  offsetY: number;
  /** In-plane rotation, degrees. */
  rotation: number;
  /** Overlay opacity 0–1. */
  opacity: number;
}

export const DEFAULT_ALIGNMENT: Alignment = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0, opacity: 0.9 };

export function isWebGLAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export class OverlayRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 50);
  private mirrorGroup = new THREE.Group();
  private alignGroup = new THREE.Group();
  private pivotGroup = new THREE.Group();
  readonly model: SkeletonModel;
  private aspect = 16 / 9;
  private mirrored = true;
  private alignment: Alignment = { ...DEFAULT_ALIGNMENT };
  private pivot = new THREE.Vector3();
  private style: RenderStyle = 'xray';

  constructor(private container: HTMLElement, onContextLost?: (lost: boolean) => void) {
    if (!isWebGLAvailable()) {
      throw new PipelineError('webgl-unavailable', 'WebGL is not available. Enable hardware acceleration in your browser settings or try Chrome/Edge.');
    }
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.className = 'overlay-canvas';
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      onContextLost?.(true);
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => onContextLost?.(false));

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.camera.position.set(0, 0, 10);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(0.3, 1, 2);
    this.scene.add(dir);

    this.model = new SkeletonModel({ style: this.style, opacity: this.alignment.opacity });
    this.pivotGroup.add(this.model.group);
    this.alignGroup.add(this.pivotGroup);
    this.mirrorGroup.add(this.alignGroup);
    this.scene.add(this.mirrorGroup);
  }

  setSize(width: number, height: number, aspect: number): void {
    this.aspect = aspect;
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = `${width}px`;
    this.renderer.domElement.style.height = `${height}px`;
    this.labelRenderer.setSize(width, height);
    this.camera.left = 0;
    this.camera.right = aspect;
    this.camera.top = 1;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
    this.applyMirror();
  }

  setMirror(mirrored: boolean): void {
    this.mirrored = mirrored;
    this.applyMirror();
  }

  private applyMirror(): void {
    this.mirrorGroup.scale.x = this.mirrored ? -1 : 1;
    this.mirrorGroup.position.x = this.mirrored ? this.aspect : 0;
  }

  setAlignment(a: Alignment): void {
    this.alignment = { ...a };
    this.model.setStyle(this.style, a.opacity);
  }

  setStyle(style: RenderStyle): void {
    this.style = style;
    this.model.setStyle(style, this.alignment.opacity);
  }

  setLayers(layers: LayerVisibility): void {
    this.model.setLayers(layers);
  }

  update(pose: AnatomyPose | null): void {
    this.model.update(pose);
    if (pose) {
      const c = pose.joints.midHip.p;
      this.pivot.set(c.x, c.y, c.z);
    }
    const a = this.alignment;
    // Alignment is expressed in screen terms, so undo the mirror for x-offset and rotation.
    const m = this.mirrored ? -1 : 1;
    // Scale / rotate about the pelvis, then offset (FR-10).
    this.pivotGroup.position.copy(this.pivot).multiplyScalar(-1);
    this.alignGroup.position.set(this.pivot.x + m * a.offsetX, this.pivot.y + a.offsetY, this.pivot.z);
    this.alignGroup.scale.setScalar(a.scale);
    this.alignGroup.rotation.z = (m * a.rotation * Math.PI) / 180;
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
    this.model.arrangeLabels(this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  dispose(): void {
    this.model.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
    void this.container;
  }
}

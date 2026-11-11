/**
 * Independent 3D inspection view (FR-12): the same reference skeleton in metric
 * world space, freely rotatable/zoomable without affecting the live overlay.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { AnatomyPose } from '../anatomy/rigMapping';
import { SkeletonModel, type LayerVisibility } from './SkeletonModel';
import type { RenderStyle } from './materials';

export class InspectorView {
  private renderer: THREE.WebGLRenderer;
  private labelRenderer: CSS2DRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.01, 50);
  private controls: OrbitControls;
  readonly model: SkeletonModel;
  private width = 0;
  private height = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.className = 'inspector-canvas';
    this.renderer.domElement.setAttribute('aria-label', '3D inspection view. Drag to rotate, scroll to zoom.');
    this.renderer.domElement.tabIndex = 0;
    container.appendChild(this.renderer.domElement);
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.8));
    const d = new THREE.DirectionalLight(0xffffff, 1.2);
    d.position.set(1, 2, 2);
    this.scene.add(d);
    const grid = new THREE.GridHelper(2, 10, 0x335577, 0x1e293b);
    grid.position.y = -0.95;
    this.scene.add(grid);

    this.model = new SkeletonModel({ style: 'xray', opacity: 0.95 });
    this.scene.add(this.model.group);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 6;
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.resetView();
  }

  resetView(): void {
    this.camera.position.set(1.6, 0.5, 2.6);
    this.controls.target.set(0, 0.05, 0);
    this.controls.update();
  }

  setStyle(style: RenderStyle): void {
    this.model.setStyle(style, 0.95);
  }

  setLayers(l: LayerVisibility): void {
    this.model.setLayers(l);
  }

  update(pose: AnatomyPose | null): void {
    this.model.update(pose);
  }

  render(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return; // collapsed panel
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.renderer.setSize(w, h);
      this.labelRenderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.model.arrangeLabels(this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.controls.dispose();
    this.model.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelRenderer.domElement.remove();
  }
}

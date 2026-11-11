/**
 * Camera acquisition and lifecycle (FR-01, FR-02, FR-03, FR-17, FR-18, NFR-05).
 * Never called before an explicit user action.
 */
import { PipelineError } from '../types/pose';

export interface CameraInfo {
  deviceId: string;
  label: string;
}

export interface CameraRequest {
  deviceId?: string;
  width: number;
  height: number;
  facingMode?: 'user' | 'environment';
}

export function checkCameraSupport(): PipelineError | null {
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return new PipelineError(
      'insecure-context',
      'Camera access needs a secure page. Open the app via https:// or http://localhost.',
    );
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return new PipelineError(
      'unsupported-browser',
      'This browser does not support camera access. Use a current version of Chrome or Edge.',
    );
  }
  return null;
}

export function mapCameraError(err: unknown): PipelineError {
  const name = (err as DOMException)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new PipelineError(
        'camera-denied',
        'Camera permission was denied. Allow camera access in the browser address bar (camera icon), then press Start again — or use Demo mode.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new PipelineError('camera-not-found', 'No suitable camera was found. Connect a webcam, choose another camera, or use Demo mode.');
    case 'NotReadableError':
    case 'AbortError':
      return new PipelineError('camera-busy', 'The camera is in use by another application (e.g. a video call). Close it and try again.');
    default:
      return new PipelineError('camera-unknown', `The camera could not be started (${name || String(err)}).`);
  }
}

export class CameraService {
  private stream: MediaStream | null = null;
  private onEnded: (() => void) | null = null;
  /** Invalidates in-flight start() calls when stop()/start() is called again. */
  private token = 0;

  get active(): boolean {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  get settings(): MediaTrackSettings | null {
    return this.stream?.getVideoTracks()[0]?.getSettings() ?? null;
  }

  /** Called when the camera is unplugged or revoked while streaming. */
  setOnEnded(cb: (() => void) | null): void {
    this.onEnded = cb;
  }

  async listCameras(): Promise<CameraInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
  }

  async start(video: HTMLVideoElement, req: CameraRequest): Promise<MediaStreamTrack> {
    const unsupported = checkCameraSupport();
    if (unsupported) throw unsupported;
    this.stop(video);
    const token = this.token;
    const constraints: MediaStreamConstraints = {
      audio: false,
      video: {
        width: { ideal: req.width },
        height: { ideal: req.height },
        frameRate: { ideal: 30, max: 60 },
        ...(req.deviceId ? { deviceId: { exact: req.deviceId } } : { facingMode: req.facingMode ?? 'user' }),
      },
    };
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (e) {
      throw mapCameraError(e);
    }
    if (token !== this.token) {
      // Stopped or restarted while the permission prompt was open: release immediately.
      stream.getTracks().forEach((t) => t.stop());
      throw new PipelineError('camera-unknown', 'Camera start was cancelled.');
    }
    this.stream = stream;
    const track = this.stream.getVideoTracks()[0];
    track.addEventListener('ended', () => this.onEnded?.());
    video.srcObject = this.stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();
    return track;
  }

  /** Releases every track and detaches the stream (AC-10). */
  stop(video?: HTMLVideoElement | null): void {
    this.token++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute('src');
      video.load();
    }
  }
}

import {
  ArcRotateCamera,
  Scene,
  Vector3,
  KeyboardEventTypes,
} from '@babylonjs/core';

export class IsometricCamera {
  camera: ArcRotateCamera;

  constructor(scene: Scene) {
    const camera = new ArcRotateCamera(
      'isoCam',
      -Math.PI / 4,       // alpha (azimuth)
      Math.PI / 3,         // beta (elevation ~60 degrees)
      16,                  // radius
      Vector3.Zero(),
      scene
    );

    camera.lowerBetaLimit = Math.PI / 6;
    camera.upperBetaLimit = Math.PI / 2.2;
    camera.lowerRadiusLimit = 6;
    camera.upperRadiusLimit = 24;

    // Right-mouse drag for orbit
    camera.attachControl(scene.getEngine().getRenderingCanvas()!, true);
    camera.inputs.removeByType('ArcRotateCameraKeyboardMoveInput');

    // Mouse wheel zoom
    camera.wheelPrecision = 8;

    this.camera = camera;

    // Q/E to rotate orbit
    scene.onKeyboardObservable.add(evt => {
      if (evt.type === KeyboardEventTypes.KEYDOWN) {
        if (evt.event.key === 'q' || evt.event.key === 'Q') {
          camera.alpha -= 0.15;
        }
        if (evt.event.key === 'e' || evt.event.key === 'E') {
          camera.alpha += 0.15;
        }
      }
    });
  }

  focusOn(x: number, z: number): void {
    this.camera.target = new Vector3(x, 0, z);
  }
}

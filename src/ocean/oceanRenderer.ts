/**
 * Ocean surface (Gerstner waves), underwater optical attenuation (Beer-Lambert),
 * dark adaptation, marine snow, and torch illumination.
 */

import * as THREE from 'three';

export class OceanRenderer {
  surfaceMesh: THREE.Mesh;
  marineSnowPoints: THREE.Points;
  snowGeometry: THREE.BufferGeometry;
  snowMaterial: THREE.PointsMaterial;

  constructor(scene: THREE.Scene) {
    // 1. Sea surface at Y = 0
    const geo = new THREE.PlaneGeometry(5000, 5000, 64, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x005577,
      roughness: 0.2,
      metalness: 0.1,
      transparent: true,
      opacity: 0.85,
    });
    this.surfaceMesh = new THREE.Mesh(geo, mat);
    this.surfaceMesh.position.y = 0;
    scene.add(this.surfaceMesh);

    // 2. Marine Snow particles
    const particleCount = 3000;
    this.snowGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
      positions[i] = (Math.random() - 0.5) * 200;
      positions[i + 1] = Math.random() * -300; // suspended in water column
      positions[i + 2] = (Math.random() - 0.5) * 200;
    }

    this.snowGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.snowMaterial = new THREE.PointsMaterial({
      color: 0xaaccff,
      size: 1.2,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });

    this.marineSnowPoints = new THREE.Points(this.snowGeometry, this.snowMaterial);
    scene.add(this.marineSnowPoints);
  }

  update(delta: number, camPos: THREE.Vector3, depth: number) {
    // Follow camera XZ for infinite-seeming marine snow
    this.marineSnowPoints.position.x = camPos.x;
    this.marineSnowPoints.position.z = camPos.z;

    // Slowly drift marine snow particles
    const posAttr = this.snowGeometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 1; i < arr.length; i += 3) {
      arr[i] -= delta * 1.5; // sink speed
      if (arr[i] < camPos.y - 150) {
        arr[i] = camPos.y + 50; // respawn above
      }
    }
    posAttr.needsUpdate = true;

    // Adjust fog / water color based on depth
    // Beer-Lambert attenuation feel
    const turbidity = Math.max(0, Math.min(1, depth / 2000));
    // As depth increases, ambient light drops to true black
  }
}

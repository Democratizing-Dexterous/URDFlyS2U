import * as THREE from "three";
import type { URDFRobot, URDFJoint, URDFLink, SolidObject } from "../types";

const IDENTITY = new THREE.Matrix4();

function applySolidMatrix(solid: SolidObject, delta: THREE.Matrix4): void {
  if (solid.instanceId !== undefined) {
    const instancedMesh = solid.mesh as unknown as THREE.InstancedMesh;
    const base = solid.instanceBaseMatrix;
    const matrix = base ? new THREE.Matrix4().multiplyMatrices(delta, base) : delta;
    instancedMesh.setMatrixAt(solid.instanceId, matrix);
    instancedMesh.instanceMatrix.needsUpdate = true;
    return;
  }

  const isIdentity = delta === IDENTITY;
  solid.mesh.matrixAutoUpdate = isIdentity;
  solid.mesh.matrix.copy(delta);
  solid.mesh.matrixWorldNeedsUpdate = true;
}

export class ForwardKinematics {
  private robot: URDFRobot | null = null;

  private linkTransforms = new Map<string, THREE.Matrix4>();

  private restTransforms = new Map<string, THREE.Matrix4>();

  private kinematicTree = new Map<string, { joint: URDFJoint; childLinkId: string }[]>();

  private rootLinkIds: string[] = [];

  setRobot(robot: URDFRobot): void {
    this.robot = robot;
    this.buildTree();
  }

  private buildTree(): void {
    if (!this.robot) return;
    this.kinematicTree.clear();

    const childIds = new Set<string>();

    for (const joint of this.robot.joints) {
      const children = this.kinematicTree.get(joint.parentLinkId) || [];
      children.push({ joint, childLinkId: joint.childLinkId });
      this.kinematicTree.set(joint.parentLinkId, children);
      childIds.add(joint.childLinkId);
    }

    this.rootLinkIds = this.robot.links.filter((l) => !childIds.has(l.id)).map((l) => l.id);

    this.restTransforms.clear();
    const identity = new THREE.Matrix4();
    for (const rootId of this.rootLinkIds) {
      this.computeRestRecursive(rootId, identity);
    }
  }

  private computeRestRecursive(linkId: string, parentWorld: THREE.Matrix4): void {
    this.restTransforms.set(linkId, parentWorld.clone());
    const children = this.kinematicTree.get(linkId);
    if (!children) return;
    for (const { joint, childLinkId } of children) {
      const restLocal = this.computeJointRestMatrix(joint);
      const childRest = new THREE.Matrix4().multiplyMatrices(parentWorld, restLocal);
      this.computeRestRecursive(childLinkId, childRest);
    }
  }

  private computeJointRestMatrix(joint: URDFJoint): THREE.Matrix4 {
    const offset = joint.axisOffset || [0, 0, 0];
    const translation = new THREE.Matrix4().makeTranslation(
      joint.origin.xyz[0] + offset[0],
      joint.origin.xyz[1] + offset[1],
      joint.origin.xyz[2] + offset[2],
    );
    const [roll, pitch, yaw] = joint.origin.rpy;
    const euler = new THREE.Euler(roll, pitch, yaw, "ZYX");
    const rotation = new THREE.Matrix4().makeRotationFromEuler(euler);
    return new THREE.Matrix4().multiplyMatrices(translation, rotation);
  }

  compute(): Map<string, THREE.Matrix4> {
    this.linkTransforms.clear();
    if (!this.robot) return this.linkTransforms;

    const identity = new THREE.Matrix4();
    for (const rootId of this.rootLinkIds) {
      this.computeRecursive(rootId, identity);
    }

    return this.linkTransforms;
  }

  private computeRecursive(linkId: string, parentWorldMatrix: THREE.Matrix4): void {
    this.linkTransforms.set(linkId, parentWorldMatrix.clone());

    const children = this.kinematicTree.get(linkId);
    if (!children) return;

    for (const { joint, childLinkId } of children) {
      const jointLocalMatrix = this.computeJointMatrix(joint);
      const childWorldMatrix = new THREE.Matrix4().multiplyMatrices(
        parentWorldMatrix,
        jointLocalMatrix,
      );
      this.computeRecursive(childLinkId, childWorldMatrix);
    }
  }

  private computeJointMatrix(joint: URDFJoint): THREE.Matrix4 {
    const matrix = new THREE.Matrix4();

    const offset = joint.axisOffset || [0, 0, 0];
    const translation = new THREE.Matrix4().makeTranslation(
      joint.origin.xyz[0] + offset[0],
      joint.origin.xyz[1] + offset[1],
      joint.origin.xyz[2] + offset[2],
    );

    const [roll, pitch, yaw] = joint.origin.rpy;
    const euler = new THREE.Euler(roll, pitch, yaw, "ZYX");
    const rotation = new THREE.Matrix4().makeRotationFromEuler(euler);

    const jointMotion = new THREE.Matrix4();
    const axis = new THREE.Vector3(...joint.axis).normalize();

    switch (joint.type) {
      case "revolute":
      case "continuous":
        jointMotion.makeRotationAxis(axis, joint.currentValue);
        break;
      case "prismatic":
        jointMotion.makeTranslation(
          axis.x * joint.currentValue,
          axis.y * joint.currentValue,
          axis.z * joint.currentValue,
        );
        break;
      case "ball": {
        const [bx, by, bz] = joint.ballValue || [0, 0, 0];
        jointMotion.makeRotationFromEuler(new THREE.Euler(bx, by, bz, "ZYX"));
        break;
      }
      case "planar": {
        jointMotion.makeRotationAxis(axis, joint.currentValue);
        break;
      }
      case "floating":
      case "fixed":
        break;
    }

    matrix.multiplyMatrices(translation, rotation);
    matrix.multiply(jointMotion);

    return matrix;
  }

  applyToScene(
    linkTransforms: Map<string, THREE.Matrix4>,
    links: URDFLink[],
    solidMap: Map<string, SolidObject>,
  ): void {
    const bound = new Set<string>();

    for (const link of links) {
      const worldMatrix = linkTransforms.get(link.id);
      if (!worldMatrix) continue;

      const restMatrix = this.restTransforms.get(link.id);
      let applyMatrix: THREE.Matrix4;
      if (restMatrix) {
        const restInverse = restMatrix.clone().invert();
        applyMatrix = new THREE.Matrix4().multiplyMatrices(worldMatrix, restInverse);
      } else {
        applyMatrix = worldMatrix;
      }

      for (const solidId of link.solidIds) {
        bound.add(solidId);
        const solid = solidMap.get(solidId);
        if (!solid?.mesh) continue;
        applySolidMatrix(solid, applyMatrix);
      }
    }

    for (const [solidId, solid] of solidMap) {
      if (bound.has(solidId) || !solid.mesh) continue;
      if (solid.instanceId === undefined && solid.mesh.matrixAutoUpdate) continue;
      applySolidMatrix(solid, IDENTITY);
    }
  }

  resetScene(links: URDFLink[], solidMap: Map<string, SolidObject>): void {
    for (const link of links) {
      for (const solidId of link.solidIds) {
        const solid = solidMap.get(solidId);
        if (!solid?.mesh) continue;
        applySolidMatrix(solid, IDENTITY);
      }
    }
  }

  getLinkRestTransform(linkId: string): THREE.Matrix4 | null {
    return this.restTransforms.get(linkId)?.clone() ?? null;
  }

  getJointWorldMatrix(jointId: string): THREE.Matrix4 | null {
    if (!this.robot) return null;
    const joint = this.robot.joints.find((j) => j.id === jointId);
    if (!joint) return null;

    const parentWorldMatrix = this.linkTransforms.get(joint.parentLinkId) || new THREE.Matrix4();
    const jointLocal = this.computeJointMatrix(joint);
    return new THREE.Matrix4().multiplyMatrices(parentWorldMatrix, jointLocal);
  }

  dispose(): void {
    this.linkTransforms.clear();
    this.restTransforms.clear();
    this.kinematicTree.clear();
    this.robot = null;
  }
}

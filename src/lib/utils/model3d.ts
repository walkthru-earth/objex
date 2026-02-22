import {
	ArcRotateCamera,
	Color4,
	Engine,
	HemisphericLight,
	Scene,
	SceneLoader,
	Vector3
} from '@babylonjs/core';
import '@babylonjs/loaders';

export interface ModelScene {
	engine: Engine;
	scene: Scene;
	camera: ArcRotateCamera;
}

export function createModelScene(canvas: HTMLCanvasElement): ModelScene {
	const engine = new Engine(canvas, true, {
		preserveDrawingBuffer: true,
		stencil: true
	});

	const scene = new Scene(engine);
	scene.clearColor = new Color4(0.1, 0.1, 0.12, 1);

	const camera = new ArcRotateCamera('camera', Math.PI / 4, Math.PI / 3, 10, Vector3.Zero(), scene);
	camera.attachControl(canvas, true);
	camera.wheelPrecision = 20;
	camera.minZ = 0.01;

	new HemisphericLight('light', new Vector3(0, 1, 0.3), scene);

	engine.runRenderLoop(() => scene.render());

	return { engine, scene, camera };
}

export async function loadModel(
	scene: Scene,
	camera: ArcRotateCamera,
	data: Uint8Array,
	extension: string
): Promise<{ meshCount: number; vertexCount: number }> {
	const blob = new Blob([data as unknown as BlobPart]);
	const url = URL.createObjectURL(blob);

	const extMap: Record<string, string> = {
		glb: '.glb',
		gltf: '.gltf',
		obj: '.obj',
		stl: '.stl',
		fbx: '.fbx'
	};
	const fileExt = extMap[extension.toLowerCase()] || '.glb';

	try {
		const result = await SceneLoader.ImportMeshAsync('', '', url, scene, undefined, fileExt);

		// Auto-frame camera to model bounds
		let min = new Vector3(Infinity, Infinity, Infinity);
		let max = new Vector3(-Infinity, -Infinity, -Infinity);
		let vertexCount = 0;

		for (const mesh of result.meshes) {
			if (mesh.getBoundingInfo) {
				const bb = mesh.getBoundingInfo().boundingBox;
				min = Vector3.Minimize(min, bb.minimumWorld);
				max = Vector3.Maximize(max, bb.maximumWorld);
			}
			if (mesh.getTotalVertices) {
				vertexCount += mesh.getTotalVertices();
			}
		}

		const center = min.add(max).scale(0.5);
		const size = max.subtract(min);
		const maxDim = Math.max(size.x, size.y, size.z);

		camera.target = center;
		camera.radius = maxDim * 2;
		camera.alpha = Math.PI / 4;
		camera.beta = Math.PI / 3;

		return { meshCount: result.meshes.length, vertexCount };
	} finally {
		URL.revokeObjectURL(url);
	}
}

export function disposeModelScene(modelScene: ModelScene) {
	modelScene.engine.stopRenderLoop();
	modelScene.scene.dispose();
	modelScene.engine.dispose();
}

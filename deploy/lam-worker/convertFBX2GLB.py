"""Convert LAM's rigged FBX output to a web-ready GLB in Blender 4.x."""

import sys
from pathlib import Path

import bpy


def clean_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.textures):
        for item in collection:
            collection.remove(item)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :]
    input_fbx = Path(argv[0]).resolve()
    output_glb = Path(argv[1]).resolve()

    if not input_fbx.exists():
        raise FileNotFoundError(f"Input FBX file not found: {input_fbx}")

    output_glb.parent.mkdir(parents=True, exist_ok=True)
    clean_scene()
    bpy.ops.import_scene.fbx(filepath=str(input_fbx))

    # Blender 4.4 removed LAM's legacy `export_colors` argument. Vertex colors
    # remain disabled through the current glTF exporter property instead.
    bpy.ops.export_scene.gltf(
        filepath=str(output_glb),
        export_format="GLB",
        export_skins=True,
        export_texcoords=False,
        export_normals=False,
        export_vertex_color="NONE",
    )


if __name__ == "__main__":
    main()

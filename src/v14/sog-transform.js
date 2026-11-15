import {matrixDecomposeColumnMajor} from './pack-contract.js';

/** Apply the Blender SOG anchor without assuming Mat4.getRotation exists. */
export function applySogAnchorTransform(entity, values, pc){
 const transform=matrixDecomposeColumnMajor(values);
 if(!transform)return false;
 const m=new pc.Mat4();
 m.data.set(transform.rotationMatrix);
 const rotation=new pc.Quat().setFromMat4(m);
 entity.setLocalPosition(...transform.position);
 entity.setLocalRotation(rotation);
 entity.setLocalScale(...transform.scale);
 return true;
}

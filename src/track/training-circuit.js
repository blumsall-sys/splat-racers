// Authoritative training track data. Blender may replace this through assets/track.json.
export const TRAINING_TRACK={
 version:1,id:'training-circuit',title:'LAB5 Training Circuit',units:'meters',coordinateSystem:'Y-up +Z-forward',
 spawns:{p1:{x:-9.8,z:-7.15,yaw:Math.PI/2},p2:{x:-9.8,z:-9.75,yaw:Math.PI/2}},
 collision:{
   walls:[
     {id:'outer-west',x:-17.10,z:0,hx:.60,hz:12.5},
     {id:'outer-east',x:17.10,z:0,hx:.60,hz:12.5},
     {id:'outer-north',x:0,z:12.15,hx:17.4,hz:.58},
     {id:'outer-south',x:0,z:-12.15,hx:17.4,hz:.58},
     {id:'island-west',x:-9.63,z:0,hx:.44,hz:4.65},
     {id:'island-east',x:9.63,z:0,hx:.44,hz:4.65},
     {id:'island-north',x:0,z:4.65,hx:9.85,hz:.44},
     {id:'island-south',x:0,z:-4.65,hx:9.85,hz:.44}
   ],
   bumps:[{x:6.8,z:-8.25,hx:1.55,hz:2.65,height:.28}],
   obstacles:[{id:'crate',x:.7,z:-8.25,yaw:0,hx:.62,hz:.59,mass:45,color:'#edce83'}]
 },
 race:{lapsToWin:5,
   // Each gate is crossed from the right-hand side of segment A->B to its left.
   // Start, eastern bend, northern straight, western bend: in driving order.
   gates:[
     {id:'START_FINISH',a:{x:-4.7,z:-11.25},b:{x:-4.7,z:-5.35}},
     {id:'EAST',a:{x:16,z:-.15},b:{x:10.15,z:-.15}},
     {id:'NORTH',a:{x:0,z:11.1},b:{x:0,z:5.25}},
     {id:'WEST',a:{x:-16,z:.15},b:{x:-10.15,z:.15}}
   ],
   waypoints:[
     {x:-12.8,z:-8.25},{x:-6.8,z:-8.25},{x:0,z:-8.25},{x:7,z:-8.25},
     {x:11.5,z:-8.2},{x:13.3,z:-6.8},{x:13.3,z:-3},{x:13.3,z:2},{x:13.3,z:6.5},
     {x:11.2,z:8.25},{x:6,z:8.25},{x:0,z:8.25},{x:-6,z:8.25},
     {x:-11.2,z:8.25},{x:-13.3,z:6.5},{x:-13.3,z:2},{x:-13.3,z:-3},
     {x:-13.3,z:-6.6}
   ]
 },
 visuals:{mode:'training',boxes:[]},
 splat:{file:null,collisionSource:null,origin:[0,0,0],scale:1,rotationY:0}
};

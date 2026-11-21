'use strict';

// DDE-specific diagnostic profiles. Values validated with B47 tester/BimmerLink.
// B47 regen state/pressure/temperature are deliberately not decoded.
const B57='0F1FE8';
const B47='0F2678';
const common=[
  ['SOOT',0x44BE,2,0.01525902],
  ['ASH',0x44BD,2,0.01525902],
  ['SINCE',0x44BF,4,1]
];
const profiles={
  [B57]:{
    engine:'B57',
    overview:common.concat([
      ['AVERAGE',0x4B2F,4,1],
      ['REQUEST',0x44BB,1,1],
      ['MODE',0x467E,4,1]
    ]),
    distanceFactor:0.001,
    averageFactor:0.001,
    regeneration:true,
    detail:[
      ['PRESSURE',0x44EB,2,0.03814755,500],
      ['TEMP',0x44EF,2,0.03128099,-50],
      ['RUNTIME',0x44B7,4,1],
      ['LOCK',0x44C2,1,1],
      ['AVG TEMP',0x4B4A,2,0.1,-3276.7],
      ['REMAINING',0x4C78,2,10]
    ]
  },
  [B47]:{
    engine:'B47',
    overview:common.concat([['AVERAGE',0x44C7,2,1]]),
    distanceFactor:0.001,
    averageFactor:1,
    regeneration:false,
    detail:[]
  }
};
function forDde(index){return Object.prototype.hasOwnProperty.call(profiles,index)?profiles[index]:null;}
function km(reading,factor){return reading ? reading.raw*factor : null;}
module.exports={B57,B47,forDde,km};

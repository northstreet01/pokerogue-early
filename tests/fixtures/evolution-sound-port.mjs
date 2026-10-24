// Sound allocation/playback is a renderer port. Original evolution timeline,
// particle math, sprite cycle and scene lifecycle remain production code.
export default class EvolutionSoundPort {
 static fadeOut(_scene,sound){sound?.stop();}
 static fadeIn(){}
}

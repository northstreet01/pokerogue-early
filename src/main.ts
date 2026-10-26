import Phaser from 'phaser';
import './i18n';
import BattleScene from './battle-scene';
import InvertPostFX from './pipelines/invert';
import { version } from '../package.json';
import UIPlugin from 'phaser3-rex-plugins/templates/ui/ui-plugin';
import BBCodeTextPlugin from 'phaser3-rex-plugins/plugins/bbcodetext-plugin';
import InputTextPlugin from 'phaser3-rex-plugins/plugins/inputtext-plugin.js';
import BBCodeText from 'phaser3-rex-plugins/plugins/bbcodetext';
import {createAppNavigation} from './app-navigation.mjs';
import {beginLoading} from './coop/loading-screen.mjs';
import './coop/play.css';
import {Mode} from './ui/ui';

const initialScene=new BattleScene();
initialScene.appUrl=new URL(location.href);

const config: Phaser.Types.Core.GameConfig = {
	type: Phaser.WEBGL,
	parent: 'app',
	loader: { maxParallelDownloads: 8 },
	scale: {
		width: 1920,
		height: 1080,
		mode: Phaser.Scale.FIT
	},
	plugins: {
		global: [{
			key: 'rexInputTextPlugin',
			plugin: InputTextPlugin,
			start: true
		}, {
			key: 'rexBBCodeTextPlugin',
			plugin: BBCodeTextPlugin,
			start: true
		}],
		scene: [{
			key: 'rexUI',
			plugin: UIPlugin,
			mapping: 'rexUI'
		}]
	},
	input: {
		mouse: {
			target: 'app'
		},
		touch: {
			target: 'app'
		},
	},
	dom: {
		createContainer: true
	},
	pixelArt: true,
	pipeline: [ InvertPostFX ] as unknown as Phaser.Types.Core.PipelineConfig,
	scene: [ initialScene ],
	version: version
};

const setPositionRelative = function (guideObject: any, x: number, y: number) {
	if (guideObject && guideObject instanceof Phaser.GameObjects.GameObject) {
		const guide = guideObject as Phaser.GameObjects.GameObject & Phaser.GameObjects.Components.Transform & Phaser.GameObjects.Components.Origin & Phaser.GameObjects.Components.Size;
		const offsetX = guide.width * (-0.5 + (0.5 - guide.originX));
		const offsetY = guide.height * (-0.5 + (0.5 - guide.originY));
		this.setPosition(guide.x + offsetX + x, guide.y + offsetY + y);
		return this;
	}

	this.setPosition(x, y);
	return this;
};

Phaser.GameObjects.Sprite.prototype.setPositionRelative = setPositionRelative;
Phaser.GameObjects.Image.prototype.setPositionRelative = setPositionRelative;
Phaser.GameObjects.NineSlice.prototype.setPositionRelative = setPositionRelative;
Phaser.GameObjects.Text.prototype.setPositionRelative = setPositionRelative;
BBCodeText.prototype.setPositionRelative = setPositionRelative;
Phaser.GameObjects.Rectangle.prototype.setPositionRelative = setPositionRelative;

document.fonts.load('16px emerald').then(() => document.fonts.load('10px pkmnems'));

const game = new Phaser.Game(config);
game.sound.pauseOnBlur = false;
let sceneSequence=0;
const documentId=crypto.randomUUID();let entryStartedAt=0,entryResourceStart=0;
const markSceneReady=(url:URL)=>{
  const app=document.getElementById('app');if(!app)return;
  app.dataset.gameDocument=documentId;app.dataset.sceneMode=url.pathname==='/coop-play.html'?'coop':url.searchParams.get('solo')==='1'?'solo':'home';
  app.dataset.sceneInitMs=(performance.now()-entryStartedAt).toFixed(1);
  app.dataset.sceneResourceRequests=String(performance.getEntriesByType('resource').length-entryResourceStart);
};
initialScene.appReady=()=>markSceneReady(initialScene.appUrl);
const navigate=createAppNavigation({base:location.href,
  close:async(scene:BattleScene,discard:boolean)=>{
    entryStartedAt=performance.now();entryResourceStart=performance.getEntriesByType('resource').length;
    const saved=await scene.prepareAppLeave?.();
    if(discard||saved===false)scene.gameData?.invalidateProfile();else await scene.gameData?.closeProfile();
  },
  replace:(url:URL)=>history.replaceState(null,'',url.pathname+url.search),
  start:(old:BattleScene,url:URL)=>new Promise<void>((resolve,reject)=>{
    const screen=beginLoading('正在切换冒险模式…',null);
    try {
      const next=new BattleScene(`adventure-${++sceneSequence}`);next.appUrl=url;
      next.navigateApp=(value,options)=>navigate(next,value,options);
      next.appReady=()=>{markSceneReady(url);screen.complete();resolve();};
      old.ui?.getHandler?.(Mode.TITLE)?.clear();
      old.appRetired=true;
      game.scene.stop(old.sys.settings.key);game.scene.remove(old.sys.settings.key);
      game.sound.stopAll();game.scene.add(next.sys.settings.key,next,true);
    } catch(error){screen.fail('模式切换失败，请保留存档后重试');reject(error);}
  })});
initialScene.navigateApp=(value,options)=>navigate(initialScene,value,options);

// The bottom navigation shares the same local flow instead of opening another
// document (and another Game). Browser back never targets an obsolete live scene.
document.querySelector('#desktopControls a[href^="/coop-play.html"]')?.addEventListener('click',event=>{
  event.preventDefault();const current=game.scene.getScenes(true)[0] as BattleScene;
  void current?.navigateApp?.('/coop-play.html?fresh=1');
});

export default game;

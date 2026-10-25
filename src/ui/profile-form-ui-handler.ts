import {FormModalUiHandler} from './form-modal-ui-handler';
import {Button} from '../battle-scene';
import i18next from '../i18n';

/** Original form/window/input components, with no account or network request. */
export default class ProfileFormUiHandler extends FormModalUiHandler {
  private cancelAction:()=>void;
  getModalTitle(){return i18next.t('localMeta:profileName');}
  getFields(){return [i18next.t('localMeta:nickname')];}
  getWidth(){return 180;}
  getMargin():[number,number,number,number]{return [0,0,48,0];}
  getButtonLabels(){return [i18next.t('localMeta:confirm'),i18next.t('localMeta:back')];}
  show(args:any[]):boolean {
    const config=args[0];let used=false;
    const submit=()=>{if(used)return;const name=this.inputs[0].text.trim();
      if(!name){this.errorMessage.setText(i18next.t('localMeta:nameRequired'));this.errorMessage.setVisible(true);return;}
      used=true;config.onSubmit(name);
    };
    this.cancelAction=()=>{if(!used){used=true;config.onCancel();}};
    if(!super.show([{buttonActions:[submit,this.cancelAction]}]))return false;
    this.inputs[0].text=config.initialName??'';
    this.submitAction=submit;return true;
  }
  processInput(button:Button):boolean {
    if(button===Button.CANCEL){this.cancelAction?.();return true;}
    return super.processInput(button);
  }
}

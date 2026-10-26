import {resolve,relative,isAbsolute} from 'node:path';
export function desktopOutput(){
  const root=resolve(process.env.POKEROGUE_DESKTOP_OUTPUT||'build/desktop');
  const part=relative(resolve('build'),root);
  if(!part||part.startsWith('..')||isAbsolute(part))throw Error('DESKTOP_OUTPUT_MUST_BE_INSIDE_BUILD');
  return root;
}

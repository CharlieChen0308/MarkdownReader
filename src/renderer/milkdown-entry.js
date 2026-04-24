// Milkdown Crepe bundle entry — imports ESM deps and exposes on window for renderer
import { Crepe } from '@milkdown/crepe';
import { replaceAll, insert } from '@milkdown/kit/utils';
import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core';
import { codeBlockSchema } from '@milkdown/kit/preset/commonmark';
import { $view } from '@milkdown/kit/utils';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';

window.MilkdownBundle = {
  Crepe,
  replaceAll,
  insert,
  editorViewCtx,
  parserCtx,
  serializerCtx,
  codeBlockSchema,
  $view,
};

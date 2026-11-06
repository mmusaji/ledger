/* The one shared state object for the whole app, and the empty report filter. */
import { store } from './util.js';

export const S = {
  rules: store.get('rules', []),
  overrides: store.get('overrides', {}),
  presets: store.get('presets', []),
  hideOneOffs: store.get('hideOneOffs', false),
  statements: [], skipped: [], txns: [], payslips: [], isa: [], pension: [],
  ignored: store.get('ignored', []), // files you removed from the app (left out even if you select the whole folder again)
  files: {}, lastSync: null, lastImport: null, key: null, meta: null, locked: false, hiddenAt: 0, sheetLocked: false,
  demo: false, loading: false, progress: 0,
  accounts: store.get('accounts', {}), accountList: [],
  scope: store.get('scope', 'household'),
  view: 'home', period: 'latest', payIdx: null,
  filter: null, showN: 100
};

export const blankFilter = () => ({ q: '', match: 'any', from: '', to: '', dir: 'out', cats: [], kinds: [], accounts: [], min: '', max: '' });

S.filter = blankFilter();

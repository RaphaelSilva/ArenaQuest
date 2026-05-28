import 'server-only';

import { getLanguageFromEnv } from './config';
import { dictEn } from './dict-en';
import { dictPt } from './dict-pt';

const language = getLanguageFromEnv();
export const dict = language === 'en' ? dictEn : dictPt;

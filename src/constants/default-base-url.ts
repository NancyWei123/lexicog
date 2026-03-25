// src/constants/default-base-url.ts

import {Vendor} from '../types/config';

export const DEFAULT_BASE_URLS: Record<Vendor, string> = {
    "Anthropic": "https://api.anthropic.com/", 
    "GoogleGemini": "https://generativelanguage.googleapis.com/v1beta/", 
    "OpenAI": "https://api.openai.com/v1/"
};
import {Config} from '@remotion/cli/config';

// Local preview uses the same bundled fonts and audio assets as CLI rendering.
Config.setPublicDir('.cache/public');
Config.setOverwriteOutput(true);

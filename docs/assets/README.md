# Demo Assets

Add a `demo.gif` here showing the app in action.

## Recording tips

1. Use a screen recorder (QuickTime on Mac, OBS, or gifcap.dev)
2. Show 2-3 different searches
3. Keep it under 30 seconds
4. Aim for 800x600 resolution

## Converting to GIF (Mac)

```bash
ffmpeg -i recording.mov -vf "fps=10,scale=800:-1" demo.gif
```

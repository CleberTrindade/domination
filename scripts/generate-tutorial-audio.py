"""Build fixed tutorial recordings, using a downloaded local model only.
Run in an isolated network namespace; see README.md. Not used by the server.
"""
import os
os.environ['ORT_DISABLE_TELEMETRY'] = '1'  # Before importing the runtime.
import argparse, hashlib, json, subprocess, tempfile, wave
from pathlib import Path
import onnxruntime
onnxruntime.disable_telemetry_events()
from piper import PiperVoice, SynthesisConfig

parser = argparse.ArgumentParser()
parser.add_argument('--model', required=True)
parser.add_argument('--transcripts', required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
output = root / 'public/audio/tutorial'
output.mkdir(parents=True, exist_ok=True)
voice = PiperVoice.load(args.model)
clips = json.loads(Path(args.transcripts).read_text())
config = SynthesisConfig(length_scale=1.04, noise_scale=0.5, noise_w_scale=0.333)
with tempfile.TemporaryDirectory() as scratch:
    for index, clip in enumerate(clips):
        wav_path = Path(scratch) / 'speech.wav'
        spoken = clip['text'].replace('CPU', 'computador').replace('→', 'para')
        with wave.open(str(wav_path), 'wb') as stream:
            voice.synthesize_wav(spoken, stream, syn_config=config)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav_path),
            '-af', 'loudnorm=I=-19:TP=-2:LRA=9', '-ar', '22050', '-ac', '1',
            '-codec:a', 'libmp3lame', '-b:a', '56k', str(output / clip['file'])], check=True)
        duration = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
            'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', str(output / clip['file'])], text=True)
        clip['duration'] = round(float(duration), 3)
        clip['bytes'] = (output / clip['file']).stat().st_size
        clip['audioSha256'] = hashlib.sha256((output / clip['file']).read_bytes()).hexdigest()
        final_name = clip['sha256'][:16] + '-' + clip['audioSha256'][:8] + '.mp3'
        (output / clip['file']).rename(output / final_name)
        clip['file'] = final_name
        print(f"{index + 1}/{len(clips)} {clip['file']} {clip['duration']}s", flush=True)
manifest = {'voice': {'name': 'Comandante', 'language': 'pt-BR', 'gender': 'male',
    'engine': 'Piper', 'model': 'pt_BR-faber-medium',
    'modelSha256': hashlib.sha256(Path(args.model).read_bytes()).hexdigest()}, 'clips': clips}
(root / 'public/tutorial-audio.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')

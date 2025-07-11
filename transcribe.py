import sys
import os
from faster_whisper import WhisperModel

# Ensure the audio file path is provided
if len(sys.argv) < 2:
    print("Usage: python transcribe.py <audio_file_path>", file=sys.stderr)
    sys.exit(1)

audio_file = sys.argv[1]

if not os.path.exists(audio_file):
    print(f"Error: File not found at {audio_file}", file=sys.stderr)
    sys.exit(1)

try:
    # Use a small model for a balance of speed and accuracy on CPU
    model = WhisperModel("small", device="cpu", compute_type="int8")

    segments, info = model.transcribe(audio_file, beam_size=5, language="ja")

    full_transcript = "".join(segment.text for segment in segments)
    
    # Print the full transcript to standard output
    print(full_transcript)

except Exception as e:
    print(f"An error occurred during transcription: {e}", file=sys.stderr)
    sys.exit(1)

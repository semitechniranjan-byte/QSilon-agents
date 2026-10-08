"""A script picks a voice by name; the codes live on the profile. No network."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from template_service import resolve_template_config

PROFILES = {
    "p1": {
        "_id": "p1",
        "name": "Hindi — Roshini",
        "language": "hindi",
        "stt_language": "hi-IN",
        "tts_language": "hi-IN",
        "tts_model_id": "sonic-3.5",
        "tts_voice_id": "voice-from-profile",
    }
}


def template(entry):
    return {
        "default_use_case": "emi_collection",
        "default_language": "hindi",
        "use_cases": {"emi_collection": {"languages": {"hindi": entry}}},
    }


def main():
    # --- the profile decides -----------------------------------------------------------
    chosen = template({
        "prompt": "Namaste",
        "voice_profile_id": "p1",
        "stt_lan_code": "hi",
        "tts_lan_code": "hi",
        "tts_model_id": "sonic-3",
        "tts_voice_id": "voice-typed-into-the-script",
    })
    cfg = resolve_template_config(chosen, {}, language="hindi", use_case="emi_collection", profiles=PROFILES)
    print("with a profile:", {k: cfg[k] for k in ("voice_profile_name", "stt_language", "tts_model_id", "tts_voice_id")})
    assert cfg["tts_voice_id"] == "voice-from-profile", "the profile's voice is the one spoken with"
    assert cfg["stt_language"] == "hi-IN" and cfg["tts_language"] == "hi-IN"
    assert cfg["tts_model_id"] == "sonic-3.5"
    assert cfg["voice_profile_name"] == "Hindi — Roshini"
    assert cfg["system_prompt"] == "Namaste", "the script itself is untouched"

    # --- a script that never picked one keeps working ------------------------------------
    plain = template({
        "prompt": "Namaste",
        "stt_lan_code": "ta",
        "tts_lan_code": "ta",
        "tts_model_id": "sonic-3",
        "tts_voice_id": "voice-typed-into-the-script",
    })
    cfg = resolve_template_config(plain, {}, language="hindi", use_case="emi_collection", profiles=PROFILES)
    print("without a profile:", {k: cfg[k] for k in ("stt_language", "tts_voice_id")})
    assert cfg["tts_voice_id"] == "voice-typed-into-the-script" and cfg["stt_language"] == "ta"
    assert cfg["voice_profile_name"] == ""

    # --- a profile that has been deleted falls back rather than going silent -------------
    cfg = resolve_template_config(chosen, {}, language="hindi", use_case="emi_collection", profiles={})
    print("profile deleted:", cfg["tts_voice_id"], cfg["stt_language"])
    assert cfg["tts_voice_id"] == "voice-typed-into-the-script" and cfg["stt_language"] == "hi"

    # --- callers that pass nothing at all behave as before -------------------------------
    cfg = resolve_template_config(chosen, {}, language="hindi", use_case="emi_collection")
    assert cfg["tts_voice_id"] == "voice-typed-into-the-script"

    # --- a profile that only names a voice leaves the rest to the script -----------------
    partial = resolve_template_config(
        chosen, {}, language="hindi", use_case="emi_collection",
        profiles={"p1": {"name": "Just a voice", "tts_voice_id": "only-the-voice"}},
    )
    print("partial profile:", partial["tts_voice_id"], partial["stt_language"], partial["tts_model_id"])
    assert partial["tts_voice_id"] == "only-the-voice"
    assert partial["stt_language"] == "hi" and partial["tts_model_id"] == "sonic-3"

    print("ALL VOICE PROFILE TESTS PASSED")


main()

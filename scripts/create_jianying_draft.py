import argparse
import json
import os
import sys
from pathlib import Path


def emit(ok, code, reason="", **data):
    print(json.dumps({
        "ok": ok,
        "code": code,
        "reason": reason,
        "data": data,
    }, ensure_ascii=False))


def find_skill_root():
    current_dir = Path(__file__).resolve().parent
    workspace_root = current_dir.parent
    candidates = [
        os.getenv("JY_SKILL_ROOT", "").strip(),
        workspace_root / "skills" / "jianying-editor",
        workspace_root / "tools" / "jianying-editor-skill",
        workspace_root / ".pull-tmp" / "jianying-editor-skill",
        Path.home() / ".agents" / "skills" / "jianying-editor",
    ]
    attempted = []
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate).resolve()
        attempted.append(str(path))
        if (path / "scripts" / "jy_wrapper.py").exists():
            return path
    raise RuntimeError("Could not find jianying-editor skill root. Tried: " + "; ".join(attempted))


def load_template(path):
    if not path:
        return {}
    template_path = Path(path).resolve()
    if not template_path.exists():
        return {}
    return json.loads(template_path.read_text(encoding="utf-8-sig"))


def duration_to_seconds(duration_us):
    try:
        return max(0.0, float(duration_us) / 1_000_000.0)
    except Exception:
        return 0.0


def seconds_expr(seconds):
    return f"{max(0.0, seconds):.3f}s"


def main():
    parser = argparse.ArgumentParser(description="Create a JianYing draft from a recorded video.")
    parser.add_argument("--video", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--title", default="")
    parser.add_argument("--draft-root", default=os.getenv("JY_PROJECTS_ROOT", ""))
    parser.add_argument("--width", type=int, default=1080)
    parser.add_argument("--height", type=int, default=1920)
    parser.add_argument("--template", default="")
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()

    video_path = Path(args.video).resolve()
    if not video_path.exists():
        emit(False, "video_missing", f"Video not found: {video_path}", video=str(video_path))
        return 2

    try:
        skill_root = find_skill_root()
        scripts_path = skill_root / "scripts"
        sys.path.insert(0, str(scripts_path))
        from jy_wrapper import JyProject
        import pyJianYingDraft as draft

        template = load_template(args.template)
        canvas = template.get("canvas") or {}
        width = int(canvas.get("width") or args.width)
        height = int(canvas.get("height") or args.height)
        project = JyProject(
            project_name=args.name,
            width=width,
            height=height,
            drafts_root=args.draft_root or None,
            overwrite=args.overwrite,
        )
        video_segment = project.add_media_safe(str(video_path), start_time="0s", track_name="VideoTrack")
        video_duration_s = duration_to_seconds(getattr(getattr(video_segment, "target_timerange", None), "duration", 0))

        added_video_assets = []
        failed_video_assets = []
        for item in template.get("videoAssets") or []:
            if item.get("enabled", True) is False or not item.get("id"):
                continue
            asset_id = str(item["id"])
            start_time = item.get("start") or "0s"
            duration = item.get("duration") or None
            track_name = item.get("trackName") or "VideoMaterial"
            cloud_video = project.add_cloud_media(
                asset_id,
                start_time=start_time,
                duration=duration,
                track_name=track_name,
            )
            if cloud_video is None:
                local_path = project.cloud_manager.download_asset(asset_id, force=True)
                if local_path and Path(local_path).exists():
                    cloud_video = project.add_media_safe(
                        local_path,
                        start_time=start_time,
                        duration=duration,
                        track_name=track_name,
                    )
            if cloud_video is None:
                failed_video_assets.append(asset_id)
                continue
            added_video_assets.append(asset_id)
            video_scale = float(item.get("scale", 1))
            cloud_video.clip_settings = draft.ClipSettings(
                scale_x=video_scale,
                scale_y=video_scale,
                transform_x=float(item.get("positionX", 0)),
                transform_y=float(item.get("positionY", 0)),
            )
            if item.get("volume") is not None:
                cloud_video.volume = float(item["volume"])

        title_config = template.get("title") or {}
        title_text = args.title.strip() or str(title_config.get("text") or "").strip()
        if title_config.get("enabled", True) and title_text:
            title_position_x = float(title_config.get("positionX", 0))
            title_position_y = float(title_config.get("positionY", 0))
            title_scale = float(title_config.get("scale", 0.8))
            project.add_text_simple(
                title_text,
                start_time=title_config.get("start") or "0.5s",
                duration=title_config.get("duration") or "2.5s",
                track_name="Title",
                anim_in=title_config.get("animation") or None,
                clip_settings=draft.ClipSettings(
                    scale_x=title_scale,
                    scale_y=title_scale,
                    transform_x=title_position_x,
                    transform_y=title_position_y,
                ),
            )

        ending_config = template.get("ending") or {}
        ending_text = str(ending_config.get("text") or "").strip()
        if ending_config.get("enabled", False) and ending_text and video_duration_s > 0:
            ending_duration = str(ending_config.get("duration") or "1.8s")
            ending_seconds = float(ending_duration.rstrip("s")) if ending_duration.endswith("s") else 1.8
            ending_position_x = float(ending_config.get("positionX", 0))
            ending_position_y = float(ending_config.get("positionY", 0))
            ending_scale = float(ending_config.get("scale", 0.8))
            project.add_text_simple(
                ending_text,
                start_time=seconds_expr(video_duration_s - ending_seconds - 0.2),
                duration=ending_duration,
                track_name="Ending",
                anim_in=ending_config.get("animation") or None,
                clip_settings=draft.ClipSettings(
                    scale_x=ending_scale,
                    scale_y=ending_scale,
                    transform_x=ending_position_x,
                    transform_y=ending_position_y,
                ),
            )

        bgm_config = template.get("bgm") or {}
        if bgm_config.get("enabled", False) and bgm_config.get("id") and video_duration_s > 0:
            bgm = project.add_cloud_music(
                str(bgm_config["id"]),
                start_time="0s",
                duration=seconds_expr(video_duration_s),
                track_name="BGM",
            )
            if bgm is not None and bgm_config.get("volume") is not None:
                bgm.volume = float(bgm_config["volume"])

        for item in template.get("sfx") or []:
            if item.get("enabled", True) is False or not item.get("id"):
                continue
            sfx = project.add_cloud_music(
                str(item["id"]),
                start_time=item.get("start") or "0s",
                duration=item.get("duration"),
                track_name="SFX",
            )
            if sfx is not None and item.get("volume") is not None:
                sfx.volume = float(item["volume"])

        save_result = project.save()
        draft_path = save_result.get("draft_path") if isinstance(save_result, dict) else ""
        emit(
            True,
            "ok",
            "",
            draft=str(draft_path),
            project=args.name,
            video=str(video_path),
            skill_root=str(skill_root),
            template=str(Path(args.template).resolve()) if args.template else "",
            durationSeconds=video_duration_s,
            addedVideoAssets=added_video_assets,
            failedVideoAssets=failed_video_assets,
        )
        return 0
    except Exception as error:
        emit(False, "exception", str(error), video=str(video_path), project=args.name)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

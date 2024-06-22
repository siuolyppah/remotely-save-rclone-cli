# Remotely Save Rclone-CLI

cli tool for decrypt file encrypted by [remotely-save](https://github.com/remotely-save/remotely-save).

## Usage

```bash
deno run --allow-read --allow-write --unstable main.ts \
    --source=<source_file_path> \
    --target=<target_file_path> \
    --password=<password> \
    --action=<encrypt_or_decrypt>
```

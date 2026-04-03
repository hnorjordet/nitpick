"""
Backup manager for XLIFF files.
Creates timestamped backups before modifications.
"""

import shutil
from pathlib import Path
from datetime import datetime
from typing import Optional, List


class BackupManager:
    """
    Manages backups of XLIFF files before modifications.
    """

    def __init__(self, backup_dir: Optional[str] = None):
        """
        Initialize backup manager.

        Args:
            backup_dir: Directory for backups. If None, creates backup next to original file
        """
        self.backup_dir = Path(backup_dir) if backup_dir else None

    def create_backup(self, file_path: str) -> Optional[str]:
        """
        Create a timestamped backup of the file.

        Args:
            file_path: Path to file to backup

        Returns:
            Path to backup file, or None if backup failed
        """
        try:
            source_path = Path(file_path)

            if not source_path.exists():
                print(f"Source file does not exist: {file_path}")
                return None

            # Determine backup location
            if self.backup_dir:
                # Use specified backup directory
                backup_root = self.backup_dir
                backup_root.mkdir(exist_ok=True)
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                backup_name = f"{source_path.stem}_{timestamp}{source_path.suffix}"
                backup_path = backup_root / backup_name
            else:
                # Place backup next to original file with _backup suffix
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                backup_name = f"{source_path.stem}_backup_{timestamp}{source_path.suffix}"
                backup_path = source_path.parent / backup_name

            # Copy file
            shutil.copy2(source_path, backup_path)

            print(f"Backup created: {backup_path}")
            return str(backup_path)

        except Exception as e:
            print(f"Backup failed: {e}")
            return None

    def list_backups(self, original_file: str) -> List[str]:
        """
        List all backups for a given file.

        Args:
            original_file: Path to original file

        Returns:
            List of backup file paths, sorted by date (newest first)
        """
        try:
            source_path = Path(original_file)

            if self.backup_dir:
                backup_root = self.backup_dir
                if not backup_root.exists():
                    return []
                # Find backups matching the original filename pattern
                pattern = f"{source_path.stem}_*{source_path.suffix}"
                backups = sorted(
                    backup_root.glob(pattern),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True
                )
            else:
                # Find backups next to original file with _backup suffix
                backup_root = source_path.parent
                pattern = f"{source_path.stem}_backup_*{source_path.suffix}"
                backups = sorted(
                    backup_root.glob(pattern),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True
                )

            return [str(b) for b in backups]

        except Exception as e:
            print(f"Error listing backups: {e}")
            return []

    def restore_backup(self, backup_path: str, target_path: Optional[str] = None) -> bool:
        """
        Restore a backup file.

        Args:
            backup_path: Path to backup file
            target_path: Where to restore to. If None, derives from backup filename

        Returns:
            True if successful
        """
        try:
            backup = Path(backup_path)

            if not backup.exists():
                print(f"Backup file does not exist: {backup_path}")
                return False

            if target_path:
                target = Path(target_path)
            else:
                # Derive original filename from backup
                # Format: originalname_backup_YYYYMMDD_HHMMSS.ext
                if '_backup_' in backup.stem:
                    # New format: next to file with _backup_ suffix
                    original_name = backup.stem.split('_backup_')[0]
                    target = backup.parent / f"{original_name}{backup.suffix}"
                else:
                    # Old format: in .backups folder (for backwards compatibility)
                    parts = backup.stem.split('_')
                    if len(parts) >= 3:
                        original_name = '_'.join(parts[:-2])
                        target = backup.parent.parent / f"{original_name}{backup.suffix}"
                    else:
                        print("Cannot determine original filename from backup")
                        return False

            # Create backup of current file before restoring (if it exists)
            if target.exists():
                self.create_backup(str(target))

            # Restore backup
            shutil.copy2(backup, target)

            print(f"Backup restored: {backup_path} -> {target}")
            return True

        except Exception as e:
            print(f"Restore failed: {e}")
            return False

    def cleanup_old_backups(self, original_file: str, keep_count: int = 10) -> int:
        """
        Remove old backups, keeping only the most recent ones.

        Args:
            original_file: Path to original file
            keep_count: Number of recent backups to keep

        Returns:
            Number of backups deleted
        """
        try:
            backups = self.list_backups(original_file)

            if len(backups) <= keep_count:
                return 0

            # Delete oldest backups
            deleted = 0
            for backup in backups[keep_count:]:
                try:
                    Path(backup).unlink()
                    deleted += 1
                except Exception as e:
                    print(f"Failed to delete {backup}: {e}")

            print(f"Deleted {deleted} old backups")
            return deleted

        except Exception as e:
            print(f"Cleanup failed: {e}")
            return 0

    def get_backup_info(self, backup_path: str) -> dict:
        """
        Get information about a backup file.

        Returns:
            Dictionary with backup metadata
        """
        try:
            backup = Path(backup_path)

            if not backup.exists():
                return {}

            stat = backup.stat()

            return {
                'path': str(backup),
                'size': stat.st_size,
                'created': datetime.fromtimestamp(stat.st_ctime).isoformat(),
                'modified': datetime.fromtimestamp(stat.st_mtime).isoformat(),
                'name': backup.name
            }

        except Exception as e:
            print(f"Error getting backup info: {e}")
            return {}

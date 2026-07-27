"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useProfilePhotoUrl } from "@/lib/profile-photo-query";

type ProfileAvatarProps = {
  profileId: string;
  photoPath: string | null;
  name: string;
  className?: string;
  fallbackClassName?: string;
  imageClassName?: string;
  onClick?: React.MouseEventHandler<HTMLSpanElement>;
};

export function ProfileAvatar({
  profileId,
  photoPath,
  name,
  className,
  fallbackClassName,
  imageClassName,
  onClick,
}: ProfileAvatarProps) {
  const photo = useProfilePhotoUrl(profileId, photoPath);
  const initials = name.trim().slice(0, 2).toUpperCase();

  return (
    <Avatar className={className} onClick={onClick}>
      <AvatarFallback
        className={cn(
          "bg-primary text-xs text-primary-foreground",
          fallbackClassName,
        )}
      >
        {initials}
      </AvatarFallback>
      {photo.data?.signedUrl ? (
        <AvatarImage
          src={photo.data.signedUrl}
          alt={name}
          className={cn("object-cover", imageClassName)}
        />
      ) : null}
    </Avatar>
  );
}

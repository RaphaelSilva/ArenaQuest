'use client';

type ImageGalleryProps = {
  url: string;
  title: string;
};

export function ImageGallery({ url, title }: ImageGalleryProps) {
  return (
    <div className="flex flex-col space-y-4">
      <h3 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{title}</h3>
      <div className="relative w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/50">
        <img
          src={url}
          alt={title}
          className="h-auto w-full object-contain"
          loading="lazy"
        />
      </div>
    </div>
  );
}

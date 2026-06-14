import { IconButton } from "./button";
import { Modal } from "./ui-lib";
import { ImageResource } from "../utils/image-resources";

import styles from "./image-preview.module.scss";

import DeleteIcon from "../icons/delete.svg";
import DownloadIcon from "../icons/download.svg";

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

function formatFileTime(date: Date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function getImageExtension(image: string) {
  const mime = image.match(/^data:(image\/[^;]+);base64,/)?.[1];
  if (mime) {
    if (mime.includes("jpeg") || mime.includes("jpg") || mime.includes("jfif")) {
      return "jpg";
    }
    if (mime.includes("webp")) return "webp";
    if (mime.includes("gif")) return "gif";
    return "png";
  }

  const cleanUrl = image.split("?")[0] ?? "";
  const ext = cleanUrl.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
  if (ext === "jpeg" || ext === "jpg" || ext === "jfif") return "jpg";
  if (ext === "webp" || ext === "gif" || ext === "png") return ext;

  return "png";
}

export function downloadImage(resource: ImageResource) {
  const link = document.createElement("a");
  const ext = getImageExtension(resource.image);
  link.href = resource.image;
  link.download = `image-${formatFileTime(new Date(resource.createdAt))}-${
    resource.imageIndex + 1
  }.${ext}`;
  link.rel = "noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function ImagePreviewModal(props: {
  resource: ImageResource;
  onClose: () => void;
  onDelete: (resource: ImageResource) => void;
}) {
  return (
    <div
      className="modal-mask"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <Modal
        title="图片预览"
        defaultMax
        onClose={props.onClose}
        actions={[
          <IconButton
            key="download"
            icon={<DownloadIcon />}
            text="下载"
            bordered
            onClick={() => downloadImage(props.resource)}
          />,
          <IconButton
            key="delete"
            icon={<DeleteIcon />}
            text="删除"
            type="danger"
            bordered
            onClick={() => props.onDelete(props.resource)}
          />,
        ]}
      >
        <div className={styles.preview}>
          <img src={props.resource.image} alt={props.resource.topic} />
        </div>
      </Modal>
    </div>
  );
}

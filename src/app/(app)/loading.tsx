import { PageState } from "@/components/app-shell";

/** Shown inside the frame while a page of the signed-in area loads. */
export default function Loading() {
  return <PageState variant="loading" />;
}

import { notFound } from "next/navigation";
import { SiteFrame } from "@/app/components/shell/SiteFrame";
import { getCatalogRepository } from "@/db/repositories/catalog";
import { ComponentGallery } from "./ComponentGallery";
import "./gallery.css";

export default async function ComponentGalleryPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  const projects = await getCatalogRepository().listSummaries("frontier");
  return <SiteFrame active="home" mainClassName="component-gallery">
    <ComponentGallery project={projects[0]} />
  </SiteFrame>;
}
